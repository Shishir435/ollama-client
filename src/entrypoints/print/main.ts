import { sanitizeExportFragment } from "@/lib/exporters/export-sanitizer"

// The print fragment arrives via localStorage, which any extension page can
// write. Treat it as untrusted: re-sanitize with the same shared config the
// exporter used, and — unless the user opted in to remote export images —
// install a CSP meta before injecting so no remote resource (img, CSS url())
// can load even if a crafted payload slipped past the DOM-level strip.
const BLOCK_REMOTE_CSP =
  "default-src 'none'; img-src 'self' data: blob:; style-src 'unsafe-inline'"

const installCsp = (): void => {
  const meta = document.createElement("meta")
  meta.httpEquiv = "Content-Security-Policy"
  meta.content = BLOCK_REMOTE_CSP
  document.head.appendChild(meta)
}

window.onload = () => {
  const content = localStorage.getItem("print_html")
  const filename = localStorage.getItem("print_filename")
  const allowRemoteImages = localStorage.getItem("print_allow_remote") === "1"

  if (content) {
    if (filename) document.title = filename
    if (!allowRemoteImages) installCsp()
    const container = document.getElementById("print-content")
    if (container) {
      container.innerHTML = sanitizeExportFragment(content, {
        allowRemoteImages
      })
    }
    localStorage.removeItem("print_html")
    localStorage.removeItem("print_filename")
    localStorage.removeItem("print_allow_remote")

    // Give a bit of time for layout/images
    setTimeout(() => {
      window.print()
      window.onafterprint = () => window.close()
    }, 800)
  } else {
    window.close()
  }
}
