import { z } from "zod"
import { browser } from "@/lib/browser-api"

const replySchema = z
  .object({
    id: z.string(),
    vector: z.array(z.number().finite()).length(384).optional(),
    error: z.string().optional()
  })
  .strict()
let worker: Worker | undefined
let idle: ReturnType<typeof setTimeout> | undefined
const pending = new Map<
  string,
  { resolve: (value: number[]) => void; reject: (error: Error) => void }
>()
const reset = () => {
  clearTimeout(idle)
  worker?.terminate()
  worker = undefined
  for (const entry of pending.values())
    entry.reject(new Error("Bundled embedding worker stopped. Please retry."))
  pending.clear()
}

/** One lazy worker per owner, reclaimed after idle; no code runs in the UI thread. */
export const generateInNativeWorker = async (
  text: string,
  signal?: AbortSignal
): Promise<number[]> => {
  signal?.throwIfAborted()
  if (pending.size >= 32)
    throw new Error("Bundled embeddings are busy. Please retry.")
  clearTimeout(idle)
  if (!worker) {
    worker = new Worker(
      browser.runtime.getURL("assets/embeddings/worker.mjs"),
      { type: "module" }
    )
    worker.onerror = reset
    worker.onmessageerror = reset
    worker.onmessage = ({ data }) => {
      const parsed = replySchema.safeParse(data)
      if (!parsed.success) {
        reset()
        return
      }
      const entry = pending.get(parsed.data.id)
      if (!entry) return
      pending.delete(parsed.data.id)
      if (parsed.data.vector) entry.resolve(parsed.data.vector)
      else
        entry.reject(
          new Error("Bundled embedding generation failed. Please retry.")
        )
      if (!pending.size) idle = setTimeout(reset, 120000)
    }
  }
  const id = crypto.randomUUID()
  let timer: ReturnType<typeof setTimeout> | undefined
  const abort = () => {
    const entry = pending.get(id)
    pending.delete(id)
    worker?.postMessage({ id, cancel: true })
    entry?.reject(new DOMException("Cancelled", "AbortError"))
    if (!pending.size) idle = setTimeout(reset, 120000)
  }
  try {
    return await new Promise<number[]>((resolve, reject) => {
      pending.set(id, { resolve, reject })
      signal?.addEventListener("abort", abort, { once: true })
      timer = setTimeout(abort, 60000)
      worker?.postMessage({ id, text })
      if (signal?.aborted) abort()
    })
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener("abort", abort)
    signal?.throwIfAborted()
  }
}
