/// <reference lib="webworker" />
import { type ChatDbEngine, createChatDbEngine } from "./chat-db-engine"
import { PersistenceOpSchema } from "./protocol"

/**
 * Message plumbing for the chat-history database owner. Exactly one instance
 * runs per browser session, hosted by the Chromium offscreen document or the
 * Firefox MV2 background page.
 *
 * Everything this file used to do is now in chat-db-engine.ts. The split is not
 * cosmetic: the engine serves both backends and there is no Worker and no OPFS
 * in the test environment, so an engine that could only be reached through
 * `postMessage` could only be tested through a browser harness.
 */

interface WorkerRequest {
  id: number
  request: unknown
}

let resolveWasmBinary: (binary: ArrayBuffer) => void
const wasmBinary = new Promise<ArrayBuffer>((resolve) => {
  resolveWasmBinary = resolve
})

let engine: ChatDbEngine | null = null
const getEngine = (): ChatDbEngine => {
  if (!engine) {
    engine = createChatDbEngine({
      wasmBinary,
      onError: (message) => console.error("[chat-db]", message)
    })
  }
  return engine
}

const respond = async (message: WorkerRequest): Promise<void> => {
  try {
    const parsed = PersistenceOpSchema.safeParse(message.request)
    if (!parsed.success) throw new Error("Invalid persistence operation")
    const result = await getEngine().submit(parsed.data)
    if (result instanceof ArrayBuffer) {
      self.postMessage({ id: message.id, ok: true, result }, [result])
    } else {
      self.postMessage({ id: message.id, ok: true, result })
    }
  } catch (error) {
    self.postMessage({
      id: message.id,
      ok: false,
      error: error instanceof Error ? error.message : String(error)
    })
  }
}

self.onmessage = (event: MessageEvent<unknown>) => {
  const message = event.data
  if (typeof message !== "object" || message === null) {
    console.error("[chat-db] Invalid worker message")
    return
  }
  if ("init" in message) {
    if (
      message.init !== true ||
      !("wasmBinary" in message) ||
      !(message.wasmBinary instanceof ArrayBuffer)
    ) {
      console.error("[chat-db] Invalid worker initialization message")
      return
    }
    resolveWasmBinary(message.wasmBinary)
    return
  }
  if (!("id" in message) || typeof message.id !== "number") {
    console.error("[chat-db] Invalid worker request envelope")
    return
  }
  // The engine owns ordering and the transaction lease, so requests are handed
  // over as they arrive.
  void respond({
    id: message.id,
    request: "request" in message ? message.request : undefined
  })
}
