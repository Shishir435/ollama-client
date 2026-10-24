import type { RuntimeSenderLike } from "@ollama-client/runtime-core/runtime-sender"
import {
  MAX_PAYLOAD_CHARS,
  PersistencePayloadTooLargeError
} from "./payload-limits"

/** One addressed channel per operation; payloads never use runtime.sendMessage. */
export const PERSISTENCE_PORT = "persistence-data-v1"
export const FRAME_CHARS = 256 * 1024

export class PersistenceChannelTimeoutError extends Error {}

/** Structural surface shared by Chrome and the browser polyfill. */
export interface DataPort {
  name: string
  sender?: RuntimeSenderLike
  postMessage: (message: unknown) => void
  disconnect: () => void
  onMessage: {
    addListener: (listener: (message: unknown) => void) => void
    removeListener: (listener: (message: unknown) => void) => void
  }
  onDisconnect: {
    addListener: (listener: () => void) => void
    removeListener: (listener: () => void) => void
  }
}

type Frame =
  | { kind: "ack"; seq: number }
  | { kind: "data"; seq: number; text: string; last: boolean }

const parseFrame = (raw: unknown): Frame => {
  if (!raw || typeof raw !== "object") throw new Error("Invalid frame")
  const frame = raw as Record<string, unknown>
  if (!Number.isSafeInteger(frame.seq) || (frame.seq as number) < 0)
    throw new Error("Invalid sequence")
  if (frame.kind === "ack" && Object.keys(frame).length === 2)
    return frame as Frame
  if (
    frame.kind === "data" &&
    Object.keys(frame).length === 4 &&
    typeof frame.text === "string" &&
    frame.text.length <= FRAME_CHARS &&
    typeof frame.last === "boolean"
  )
    return frame as Frame
  throw new Error("Invalid frame")
}

/**
 * Bounded frames with acknowledgement backpressure, ordered assembly, and
 * cleanup on disconnect/timeout. A channel carries one request and response.
 * The receiver validates the complete operation before executing any SQL.
 */
export const makePortChannel = (port: DataPort, timeoutMs = 30_000) => {
  let parts: string[] = []
  let chars = 0
  let nextSeq = 0
  let ack:
    | { seq: number; resolve: () => void; reject: (error: Error) => void }
    | undefined
  let settled = false
  let resolve!: (value: unknown) => void
  let reject!: (error: Error) => void
  const received = new Promise<unknown>((yes, no) => {
    resolve = yes
    reject = no
  })
  // A sender can fail before its caller starts awaiting the incoming payload.
  void received.catch(() => {})
  const timer = setTimeout(
    () =>
      fail(new PersistenceChannelTimeoutError("Persistence channel timed out")),
    timeoutMs
  )

  const cleanup = () => {
    clearTimeout(timer)
    port.onMessage.removeListener(onMessage)
    port.onDisconnect.removeListener(onDisconnect)
    parts = []
  }
  const fail = (error: Error) => {
    if (settled) return
    settled = true
    ack?.reject(error)
    ack = undefined
    reject(error)
    cleanup()
    port.disconnect()
  }
  const onDisconnect = () => fail(new Error("Persistence channel disconnected"))
  const onMessage = (raw: unknown) => {
    try {
      const frame = parseFrame(raw)
      if (frame.kind === "ack") {
        if (!ack || frame.seq !== ack.seq)
          throw new Error("Invalid persistence acknowledgement")
        const pending = ack
        ack = undefined
        pending.resolve()
        return
      }
      if (frame.seq !== nextSeq++)
        throw new Error("Invalid persistence frame sequence")
      if (chars + frame.text.length > MAX_PAYLOAD_CHARS)
        throw new PersistencePayloadTooLargeError()
      parts.push(frame.text)
      chars += frame.text.length
      if (frame.last) {
        const value: unknown = JSON.parse(parts.join(""))
        parts = []
        resolve(value)
      }
      port.postMessage({ kind: "ack", seq: frame.seq })
    } catch (error) {
      fail(
        error instanceof PersistencePayloadTooLargeError
          ? error
          : new Error("Invalid persistence channel payload")
      )
    }
  }
  port.onMessage.addListener(onMessage)
  port.onDisconnect.addListener(onDisconnect)

  return {
    received,
    async send(value: unknown) {
      let json: string
      try {
        json = JSON.stringify(value)
      } catch (error) {
        if (error instanceof RangeError)
          throw new PersistencePayloadTooLargeError()
        throw error
      }
      if (json.length > MAX_PAYLOAD_CHARS)
        throw new PersistencePayloadTooLargeError()
      for (
        let offset = 0, seq = 0;
        offset < json.length;
        offset += FRAME_CHARS, seq++
      ) {
        if (settled) throw new Error("Persistence channel closed")
        await new Promise<void>((yes, no) => {
          ack = { seq, resolve: yes, reject: no }
          try {
            port.postMessage({
              kind: "data",
              seq,
              text: json.slice(offset, offset + FRAME_CHARS),
              last: offset + FRAME_CHARS >= json.length
            })
          } catch (error) {
            ack = undefined
            no(error)
          }
        })
      }
    },
    close() {
      fail(new Error("Persistence channel closed"))
    }
  }
}
