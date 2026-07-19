import {
  type OwnerRpcMessage,
  SPIKE_OWNER_RPC
} from "@/spike/opfs/owner-protocol"

// Section 9.4 spike phase 2: the offscreen owner document. Hosts the one
// SQLite worker and answers spike-owner-rpc runtime messages from every
// other extension context. Nothing else in the extension may open the
// spike database.

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
    worker = new Worker(
      new URL("../../spike/opfs/owner-worker.ts", import.meta.url),
      { type: "module" }
    )
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
      else entry.reject(new Error(event.data.error ?? "Unknown worker error"))
    }
    worker.onerror = () => rejectAllPending("Owner worker crashed")
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

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  const rpc = message as OwnerRpcMessage | undefined
  if (rpc?.type !== SPIKE_OWNER_RPC) return false

  ;(async () => {
    if (rpc.op === "ownerInfo") {
      sendResponse({ ok: true, result: { ownerId, workerGeneration } })
      return
    }
    if (rpc.op === "terminateWorker") {
      // Gate 4/5 hook: simulate a worker crash. Pending calls fail, the next
      // op spawns a fresh worker generation which must recover from OPFS.
      worker?.terminate()
      worker = null
      rejectAllPending("Owner worker terminated by test")
      sendResponse({ ok: true, result: { ownerId, workerGeneration } })
      return
    }
    try {
      const result = await callWorker(rpc.op, rpc.payload)
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
