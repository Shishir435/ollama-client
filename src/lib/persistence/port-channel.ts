import type { RuntimeSenderLike } from "@ollama-client/runtime-core/runtime-sender"
import { base64ToBytes, bytesToBase64 } from "@/lib/image-utils"
import {
  MAX_DATABASE_BYTES,
  MAX_PAYLOAD_CHARS,
  PersistencePayloadTooLargeError
} from "./payload-limits"

/** One addressed channel per operation; payloads never use runtime.sendMessage. */
export const PERSISTENCE_PORT = "persistence-data-v1"
export const FRAME_CHARS = 256 * 1024
/** Time a channel may stay open; a database transfer is the longest user. */
export const TRANSFER_TIMEOUT_MS = 300_000
/** Raw bytes per binary frame; their base64 is exactly `FRAME_CHARS`. */
export const BYTES_PER_FRAME = (FRAME_CHARS / 4) * 3

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
  | {
      kind: "data"
      seq: number
      text: string
      last: boolean
      /** On the last data frame only: how many raw bytes follow it. */
      bytes?: number
    }
  | { kind: "bytes"; seq: number; text: string; last: boolean }

const parseFrame = (raw: unknown): Frame => {
  if (!raw || typeof raw !== "object") throw new Error("Invalid frame")
  const frame = raw as Record<string, unknown>
  if (!Number.isSafeInteger(frame.seq) || (frame.seq as number) < 0)
    throw new Error("Invalid sequence")
  if (frame.kind === "ack" && Object.keys(frame).length === 2)
    return frame as Frame
  if (
    frame.kind === "data" &&
    typeof frame.text === "string" &&
    frame.text.length <= FRAME_CHARS &&
    typeof frame.last === "boolean"
  ) {
    const keys = Object.keys(frame).length
    if (keys === 4) return frame as Frame
    if (
      keys === 5 &&
      frame.last === true &&
      Number.isSafeInteger(frame.bytes) &&
      (frame.bytes as number) > 0
    )
      return frame as Frame
  }
  if (
    frame.kind === "bytes" &&
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
 *
 * A message may be followed by raw bytes (`send(value, bytes)`), which is how a
 * whole database moves. They travel as base64 frames of their own and are
 * decoded straight into one pre-sized buffer, so no string the size of the
 * database ever exists: the single JSON string this replaced stopped at 256 Mi
 * characters, which capped a database near 192 MB.
 */
export const makePortChannel = (port: DataPort, timeoutMs = 30_000) => {
  let parts: string[] = []
  let chars = 0
  let nextSeq = 0
  let incoming: { buffer: Uint8Array; offset: number } | undefined
  let ack:
    | { seq: number; resolve: () => void; reject: (error: Error) => void }
    | undefined
  let settled = false
  let resolve!: (value: unknown) => void
  let reject!: (error: Error) => void
  let resolveBytes!: (value: Uint8Array | undefined) => void
  let rejectBytes!: (error: Error) => void
  const received = new Promise<unknown>((yes, no) => {
    resolve = yes
    reject = no
  })
  const bytes = new Promise<Uint8Array | undefined>((yes, no) => {
    resolveBytes = yes
    rejectBytes = no
  })
  // A sender can fail before its caller starts awaiting the incoming payload.
  void received.catch(() => {})
  void bytes.catch(() => {})
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
    incoming = undefined
  }
  const fail = (error: Error) => {
    if (settled) return
    settled = true
    ack?.reject(error)
    ack = undefined
    reject(error)
    rejectBytes(error)
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
      if (frame.kind === "bytes") {
        if (!incoming) throw new Error("Unexpected bytes frame")
        const chunk = base64ToBytes(frame.text)
        const end = incoming.offset + chunk.byteLength
        if (
          chunk.byteLength > BYTES_PER_FRAME ||
          end > incoming.buffer.byteLength ||
          frame.last !== (end === incoming.buffer.byteLength)
        )
          throw new Error("Invalid bytes frame")
        incoming.buffer.set(chunk, incoming.offset)
        incoming.offset = end
        if (frame.last) {
          const complete = incoming.buffer
          incoming = undefined
          resolveBytes(complete)
        }
        port.postMessage({ kind: "ack", seq: frame.seq })
        return
      }
      if (incoming) throw new Error("Unexpected data frame")
      if (chars + frame.text.length > MAX_PAYLOAD_CHARS)
        throw new PersistencePayloadTooLargeError()
      parts.push(frame.text)
      chars += frame.text.length
      if (frame.last) {
        const value: unknown = JSON.parse(parts.join(""))
        parts = []
        if (frame.bytes) {
          if (frame.bytes > MAX_DATABASE_BYTES)
            throw new PersistencePayloadTooLargeError()
          incoming = { buffer: new Uint8Array(frame.bytes), offset: 0 }
        } else {
          resolveBytes(undefined)
        }
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

  const sendFrame = (seq: number, frame: Record<string, unknown>) =>
    new Promise<void>((yes, no) => {
      if (settled) {
        no(new Error("Persistence channel closed"))
        return
      }
      ack = { seq, resolve: yes, reject: no }
      try {
        port.postMessage({ ...frame, seq })
      } catch (error) {
        ack = undefined
        no(error)
      }
    })

  return {
    received,
    /** What followed the message, or undefined when nothing did. */
    bytes,
    async send(value: unknown, trailing?: Uint8Array) {
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
      const total = trailing?.byteLength ?? 0
      if (total > MAX_DATABASE_BYTES)
        throw new PersistencePayloadTooLargeError()
      let seq = 0
      for (let offset = 0; offset < json.length; offset += FRAME_CHARS, seq++) {
        const last = offset + FRAME_CHARS >= json.length
        await sendFrame(seq, {
          kind: "data",
          text: json.slice(offset, offset + FRAME_CHARS),
          last,
          ...(last && total > 0 ? { bytes: total } : {})
        })
      }
      for (let offset = 0; offset < total; offset += BYTES_PER_FRAME, seq++) {
        const end = Math.min(offset + BYTES_PER_FRAME, total)
        await sendFrame(seq, {
          kind: "bytes",
          text: bytesToBase64(trailing!.subarray(offset, end)),
          last: end === total
        })
      }
    },
    close() {
      fail(new Error("Persistence channel closed"))
    }
  }
}
