import {
  type OwnerOp,
  type OwnerRpcMessage,
  SPIKE_OWNER_RPC
} from "./owner-protocol"

// Section 9.4 spike: the host-side worker plumbing shared by both owner
// hosts — the Chromium offscreen document and the Firefox MV2 persistent
// background page. Exactly one host exists per browser session; it owns the
// only SQLite worker and answers spike-owner-rpc runtime messages.

export interface OwnerHost {
  /** Direct in-context call — for code living in the host context itself
   * (a background page cannot runtime-message its own listeners). */
  handleOp: (op: OwnerOp, payload?: unknown) => Promise<unknown>
  /** Attach the runtime.onMessage listener answering SPIKE_OWNER_RPC. */
  registerRpcListener: () => void
}

// Fetched once per host; each worker generation gets a structured-clone
// copy. Benchmark builds copy sqlite3.wasm to this stable path (see the
// build:publicAssets hook) because bundler ?url imports get inlined as
// data: URLs in Firefox MV2 iife output, which fetch() rejects.
let wasmBinaryPromise: Promise<ArrayBuffer> | null = null
const getWasmBinary = (): Promise<ArrayBuffer> => {
  if (!wasmBinaryPromise) {
    const wasmUrl = chrome.runtime.getURL("assets/sqlite3.wasm")
    const attempt = fetch(wasmUrl)
      .then((response) => {
        if (!response.ok) {
          throw new Error(`Failed to fetch sqlite3.wasm: ${response.status}`)
        }
        return response.arrayBuffer()
      })
      .catch((error) => {
        // Never cache a rejection: the Firefox background page hosts the
        // owner for the whole browser session, and a single transient fetch
        // failure must not disable persistence until restart. The next RPC
        // retries the fetch.
        if (wasmBinaryPromise === attempt) wasmBinaryPromise = null
        throw error
      })
    wasmBinaryPromise = attempt
  }
  return wasmBinaryPromise
}

export const createOwnerHost = (): OwnerHost => {
  const ownerId = crypto.randomUUID()
  let worker: Worker | null = null
  let workerGeneration = 0
  let requestId = 0
  const pending = new Map<
    number,
    {
      resolve: (value: unknown) => void
      reject: (reason: Error) => void
    }
  >()

  const rejectAllPending = (reason: string): void => {
    for (const [id, entry] of pending) {
      pending.delete(id)
      entry.reject(new Error(reason))
    }
  }

  const ensureWorker = (): Worker => {
    if (!worker) {
      worker = new Worker(new URL("./owner-worker.ts", import.meta.url), {
        type: "module"
      })
      workerGeneration += 1
      worker.onmessage = (
        event: MessageEvent<{
          id: number
          ok: boolean
          result?: unknown
          error?: string
        }>
      ) => {
        const entry = pending.get(event.data.id)
        if (!entry) return
        pending.delete(event.data.id)
        if (event.data.ok) entry.resolve(event.data.result)
        else {
          entry.reject(new Error(event.data.error ?? "Unknown worker error"))
        }
      }
      worker.onerror = () => {
        // Drop the dead worker so the next RPC spawns a fresh generation;
        // otherwise every later call would hang until the client timeout.
        worker = null
        rejectAllPending("Owner worker crashed")
      }
      // Ops queued before this arrives block inside the worker awaiting the
      // bytes; init is handled outside the worker's op chain.
      const spawned = worker
      void getWasmBinary()
        .then((binary) => {
          if (worker === spawned) {
            spawned.postMessage({ op: "init", wasmBinary: binary })
          }
        })
        .catch((error) => {
          if (worker === spawned) {
            worker = null
            spawned.terminate()
            rejectAllPending(
              error instanceof Error ? error.message : String(error)
            )
          }
        })
    }
    return worker
  }

  const callWorker = (op: string, payload: unknown): Promise<unknown> => {
    requestId += 1
    const id = requestId
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject })
      ensureWorker().postMessage({ id, op, payload })
    })
  }

  const handleOp = async (op: OwnerOp, payload?: unknown): Promise<unknown> => {
    if (op === "ownerInfo") {
      return { ownerId, workerGeneration }
    }
    if (op === "terminateWorker") {
      // Gate 4/5 hook: simulate a worker crash. Pending calls fail, the next
      // op spawns a fresh worker generation which must recover from OPFS.
      worker?.terminate()
      worker = null
      rejectAllPending("Owner worker terminated by test")
      return { ownerId, workerGeneration }
    }
    return callWorker(op, payload)
  }

  const registerRpcListener = (): void => {
    chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      const rpc = message as OwnerRpcMessage | undefined
      if (rpc?.type !== SPIKE_OWNER_RPC) return false
      ;(async () => {
        try {
          const result = await handleOp(rpc.op, rpc.payload)
          sendResponse({ ok: true, result })
        } catch (error) {
          sendResponse({
            ok: false,
            error: error instanceof Error ? error.message : String(error)
          })
        }
      })()
      return true
    })
  }

  return { handleOp, registerRpcListener }
}
