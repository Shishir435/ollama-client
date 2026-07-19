import { sanitizeExportFragment } from "@/lib/exporters/export-sanitizer"
import { consumePrintJob, purgeStalePrintJobs } from "@/lib/exporters/print-job"

// The print payload arrives via localStorage, which any extension page can
// write. Treat it as untrusted: re-sanitize with the same shared config the
// exporter used, and — unless the user opted in to remote export images —
// install a CSP meta before injecting so no remote resource (img, CSS url())
// can load even if a crafted payload slipped past the DOM-level strip.
//
// Each print window consumes only its own job (`?job=<id>`), so concurrent
// exports cannot overwrite or clear each other's documents.
const BLOCK_REMOTE_CSP =
  "default-src 'none'; img-src 'self' data: blob:; style-src 'unsafe-inline'"

const installCsp = (): void => {
  const meta = document.createElement("meta")
  meta.httpEquiv = "Content-Security-Policy"
  meta.content = BLOCK_REMOTE_CSP
  document.head.appendChild(meta)
}

window.onload = () => {
  const jobId = new URLSearchParams(window.location.search).get("job")
  const job = jobId ? consumePrintJob(jobId) : null
  purgeStalePrintJobs()

  if (job) {
    if (job.filename) document.title = job.filename
    if (!job.allowRemoteImages) installCsp()
    const container = document.getElementById("print-content")
    if (container) {
      container.innerHTML = sanitizeExportFragment(job.html, {
        allowRemoteImages: job.allowRemoteImages
      })
    }

    // Give a bit of time for layout/images
    setTimeout(() => {
      window.print()
      window.onafterprint = () => window.close()
    }, 800)
  } else {
    window.close()
  }
}
