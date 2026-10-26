import { abortableDelay } from "@/lib/abortable-delay"
import { browser } from "@/lib/browser-api"
import { logger } from "@/lib/logger"
import { ensurePersistenceHost } from "@/lib/persistence/client"

export const INGESTION_PROCESS_REQUEST = "ingestion-process-request"

/** Tells the host to stop parsing a job; nothing is answered. */
export const INGESTION_CANCEL_REQUEST = "ingestion-cancel-request"

export type IngestionProcessResponse =
  | { ok: true }
  | { ok: false; error: string }

/**
 * A cold host answers nothing: on Chromium the offscreen document may not
 * exist yet, on Firefox the hidden processor frame may still be loading, and
 * Chrome rejects a sendMessage with no receiver outright. Neither is a parsing
 * failure, so back off across a real startup budget (~12s) before giving up —
 * a permanent failure here compensates and destroys a valid staged job.
 */
const READY_RETRY_DELAYS_MS = [50, 100, 200, 400, 800, 1600, 3200, 3200, 3200]

const requestOnce = async (
  jobId: string
): Promise<IngestionProcessResponse | undefined> => {
  try {
    return (await browser.runtime.sendMessage({
      type: INGESTION_PROCESS_REQUEST,
      jobId
    })) as IngestionProcessResponse | undefined
  } catch (error) {
    // "Receiving end does not exist" and dropped responses are both readiness
    // signals, not job outcomes.
    logger.verbose(
      "File processor host not reachable yet",
      "IngestionProcessor",
      { jobId, error }
    )
    return undefined
  }
}

const cancelOnHost = (jobId: string): void => {
  void browser.runtime
    .sendMessage({ type: INGESTION_CANCEL_REQUEST, jobId })
    .catch(() => undefined)
}

export const processStagedIngestion = async (
  jobId: string,
  signal?: AbortSignal
): Promise<void> => {
  if (!signal) return requestParse(jobId)
  signal.throwIfAborted()
  let onAbort: (() => void) | undefined
  // The host may never answer a parse it was told to drop, so the caller does
  // not wait for it: the cancel is sent and the call settles on the abort.
  const aborted = new Promise<never>((_, reject) => {
    onAbort = () => {
      cancelOnHost(jobId)
      reject(signal.reason)
    }
    signal.addEventListener("abort", onAbort, { once: true })
  })
  try {
    await Promise.race([requestParse(jobId, signal), aborted])
  } finally {
    if (onAbort) signal.removeEventListener("abort", onAbort)
  }
}

const requestParse = async (
  jobId: string,
  signal?: AbortSignal
): Promise<void> => {
  for (let attempt = 0; ; attempt++) {
    signal?.throwIfAborted()
    // The processor lives in the persistence owner context, so the same
    // ensure path brings it up; retried because that context can be torn
    // down between attempts.
    await ensurePersistenceHost().catch((error: unknown) => {
      logger.warn(
        "Failed to ensure file processor host",
        "IngestionProcessor",
        {
          jobId,
          error
        }
      )
    })

    // The cancel message may have gone out while the host was still starting,
    // before it could act on it, so a parse is not requested for a job whose
    // caller has already left.
    signal?.throwIfAborted()
    const response = await requestOnce(jobId)
    if (response?.ok) return
    if (response && !response.ok) throw new Error(response.error)
    if (attempt >= READY_RETRY_DELAYS_MS.length) break
    await abortableDelay(READY_RETRY_DELAYS_MS[attempt] ?? 0, signal)
  }
  throw new Error("The durable file processor host is unavailable")
}
