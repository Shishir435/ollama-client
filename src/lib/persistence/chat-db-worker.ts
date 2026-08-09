/// <reference lib="webworker" />
import { type ChatDbEngine, createChatDbEngine } from "./chat-db-engine"
import type { PersistenceOp } from "./protocol"

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
  request: PersistenceOp
}

interface InitMessage {
  init: true
  wasmBinary: ArrayBuffer
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
    const result = await getEngine().submit(message.request)
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

self.onmessage = (event: MessageEvent<WorkerRequest | InitMessage>) => {
  if ("init" in event.data) {
    resolveWasmBinary(event.data.wasmBinary)
    return
  }
  // The engine owns ordering and the transaction lease, so requests are handed
  // over as they arrive.
  void respond(event.data)
}
