import { browser } from "@/lib/browser-api"

export const INGESTION_PROCESS_REQUEST = "ingestion-process-request"

export type IngestionProcessResponse =
  | { ok: true }
  | { ok: false; error: string }

const requestOnce = async (
  jobId: string
): Promise<IngestionProcessResponse | undefined> =>
  (await browser.runtime.sendMessage({
    type: INGESTION_PROCESS_REQUEST,
    jobId
  })) as IngestionProcessResponse | undefined

export const processStagedIngestion = async (jobId: string): Promise<void> => {
  for (let attempt = 0; attempt < 3; attempt++) {
    const response = await requestOnce(jobId)
    if (response?.ok) return
    if (response && !response.ok) {
      throw new Error(response.error)
    }
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error("The durable file processor host is unavailable")
}
