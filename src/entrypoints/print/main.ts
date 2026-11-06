import {
  loadTranslation,
  normalizeSupportedLanguage
} from "@/i18n/locale-loader"
import { sanitizeExportFragment } from "@/lib/exporters/export-sanitizer"
import { consumePrintJob, purgeStalePrintJobs } from "@/lib/exporters/print-job"
import { getPdfStyles } from "@/lib/exporters/styles"
import { CONTENT_SETTINGS } from "@/lib/storage/content-settings"
import { readSetting } from "@/lib/storage/setting-access"

/**
 * The print payload arrives via localStorage, which any extension page can
 * write. Treat it as untrusted: re-sanitize with the same shared config the
 * exporter used, and — unless the user opted in to remote export images —
 * install a CSP meta before injecting so no remote resource (img, CSS url())
 * can load even if a crafted payload slipped past the DOM-level strip.
 *
 * Each print window consumes only its own job (`?job=<id>`), so concurrent
 * exports cannot overwrite or clear each other's documents.
 */
const BLOCK_REMOTE_CSP =
  "default-src 'none'; img-src 'self' data: blob:; style-src 'unsafe-inline'"

const installCsp = (): void => {
  const meta = document.createElement("meta")
  meta.httpEquiv = "Content-Security-Policy"
  meta.content = BLOCK_REMOTE_CSP
  document.head.appendChild(meta)
}

const installExportStyles = (): void => {
  const style = document.createElement("style")
  style.textContent = getPdfStyles()
  document.head.appendChild(style)
}

/** Longest the page waits on the stored language before using the browser's. */
const LANGUAGE_WAIT_MS = 400

/**
 * The user's UI language, read from storage with a short cap, so the document
 * is labelled for assistive technology and a printed export hyphenates in the
 * right language. Falls back to the page's declared language when unreadable.
 */
const resolveLanguage = async (): Promise<string> => {
  try {
    const stored = await Promise.race([
      readSetting(CONTENT_SETTINGS.LANGUAGE),
      new Promise<undefined>((resolve) =>
        setTimeout(() => resolve(undefined), LANGUAGE_WAIT_MS)
      )
    ])
    return stored
      ? normalizeSupportedLanguage(stored)
      : document.documentElement.lang || "en"
  } catch {
    return document.documentElement.lang || "en"
  }
}

/**
 * A missing, spent or expired job is said plainly. Closing the window without
 * a word looked like the export button did nothing.
 */
const showMissingJob = async (language: string): Promise<void> => {
  let text = ""
  try {
    const common = (await loadTranslation(normalizeSupportedLanguage(language)))
      .common as Record<string, unknown> | undefined
    text =
      typeof common?.print_job_missing === "string"
        ? common.print_job_missing
        : ""
  } catch {
    // A locale that cannot load leaves the page blank rather than wrong.
  }
  const message = document.createElement("p")
  message.setAttribute("role", "alert")
  message.textContent = text
  document.getElementById("print-content")?.replaceChildren(message)
}

window.onload = async () => {
  document.documentElement.lang = await resolveLanguage()
  const jobId = new URLSearchParams(window.location.search).get("job")
  const job = jobId ? consumePrintJob(jobId) : null
  purgeStalePrintJobs()

  if (job) {
    installExportStyles()
    if (job.filename) document.title = job.filename
    if (!job.allowRemoteImages) installCsp()
    const container = document.getElementById("print-content")
    if (container) {
      container.innerHTML = sanitizeExportFragment(job.html, {
        allowRemoteImages: job.allowRemoteImages
      })
    }

    /**
     * `onafterprint` is assigned before `print()` runs: print can block, and a
     * handler set afterwards may miss the event. Printing waits for the
     * document's images to settle rather than a fixed delay, and a blocked or
     * broken image counts as settled so it cannot hold the print forever.
     */
    window.onafterprint = () => window.close()
    const images = Array.from(container?.querySelectorAll("img") ?? [])
    void Promise.all(
      images.map((image) =>
        image.complete
          ? Promise.resolve()
          : new Promise<void>((resolve) => {
              image.addEventListener("load", () => resolve(), { once: true })
              image.addEventListener("error", () => resolve(), { once: true })
            })
      )
    ).then(() => window.print())
  } else {
    await showMissingJob(document.documentElement.lang)
  }
}
