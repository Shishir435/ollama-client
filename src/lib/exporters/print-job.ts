/**
 * The localStorage handoff between the PDF exporter and the print page. Each
 * export writes ONE job keyed by a fresh id and opens `print.html?job=<id>`,
 * so concurrent exports never overwrite or clear each other's payloads. The
 * print page consumes (reads + deletes) only its own job and purges anything
 * stale a crashed window left behind.
 */

export interface PrintJobPayload {
  html: string
  filename: string
  allowRemoteImages: boolean
  createdAt: number
}

const PRINT_JOB_PREFIX = "print-job:"

/** Payloads older than this are leftovers from a window that never printed. */
const STALE_JOB_MS = 10 * 60 * 1000

export const printJobKey = (jobId: string): string =>
  `${PRINT_JOB_PREFIX}${jobId}`

/** Read and delete one job's payload; null when missing or malformed. */
export const consumePrintJob = (jobId: string): PrintJobPayload | null => {
  const key = printJobKey(jobId)
  const raw = localStorage.getItem(key)
  localStorage.removeItem(key)
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as Partial<PrintJobPayload>
    if (typeof parsed.html !== "string") return null
    return {
      html: parsed.html,
      filename: typeof parsed.filename === "string" ? parsed.filename : "",
      allowRemoteImages: parsed.allowRemoteImages === true,
      createdAt: typeof parsed.createdAt === "number" ? parsed.createdAt : 0
    }
  } catch {
    return null
  }
}

/** Drop stale jobs and the pre-job-id legacy keys from older versions. */
export const purgeStalePrintJobs = (now = Date.now()): void => {
  for (const legacyKey of [
    "print_html",
    "print_filename",
    "print_allow_remote"
  ]) {
    localStorage.removeItem(legacyKey)
  }
  const staleKeys: string[] = []
  for (let index = 0; index < localStorage.length; index++) {
    const key = localStorage.key(index)
    if (!key?.startsWith(PRINT_JOB_PREFIX)) continue
    let createdAt = 0
    try {
      const parsed = JSON.parse(localStorage.getItem(key) ?? "") as {
        createdAt?: number
      }
      createdAt = typeof parsed.createdAt === "number" ? parsed.createdAt : 0
    } catch {
      // unparseable payloads are stale by definition
    }
    if (now - createdAt > STALE_JOB_MS) staleKeys.push(key)
  }
  for (const key of staleKeys) localStorage.removeItem(key)
}
