import { browser } from "@/lib/browser-api"
import { logger } from "@/lib/logger"
import { ensurePersistenceHost } from "@/lib/persistence/client"

export const INGESTION_PROCESS_REQUEST = "ingestion-process-request"

export type IngestionProcessResponse =
  | { ok: true }
  | { ok: false; error: string }

// A cold host answers nothing: on Chromium the offscreen document may not
// exist yet, on Firefox the hidden processor frame may still be loading, and
// Chrome rejects a sendMessage with no receiver outright. Neither is a parsing
// failure, so back off across a real startup budget (~12s) before giving up —
// a permanent failure here compensates and destroys a valid staged job.
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

export const processStagedIngestion = async (jobId: string): Promise<void> => {
  for (let attempt = 0; ; attempt++) {
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

    const response = await requestOnce(jobId)
    if (response?.ok) return
    if (response && !response.ok) throw new Error(response.error)
    if (attempt >= READY_RETRY_DELAYS_MS.length) break
    await new Promise((resolve) =>
      setTimeout(resolve, READY_RETRY_DELAYS_MS[attempt])
    )
  }
  throw new Error("The durable file processor host is unavailable")
}
