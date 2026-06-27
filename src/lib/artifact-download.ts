/**
 * Per-artifact download. Distinct from whole-session export
 * (`use-export-chat.ts`): this saves one generated artifact (HTML, SVG, Mermaid,
 * or a code block) to its own file.
 *
 * Save path, in order of preference:
 *   1. `browser.downloads` (optional `downloads` permission) — a real entry in
 *      the browser download manager with a Save-As dialog. Requested on the
 *      click (a user gesture).
 *   2. Anchor `<a download>` fallback (`downloadFile`) — no permission needed, so
 *      the action still works if the user declines `downloads`.
 */

import type { ChatArtifact } from "@/lib/artifacts"
import { browser } from "@/lib/browser-api"
import { downloadFile } from "@/lib/exporters/utils"
import { logger } from "@/lib/logger"
import { hasPermission, requestPermission } from "@/lib/permissions"

/** File extension per code language; falls back to `.txt` for unknown code. */
const CODE_EXTENSIONS: Record<string, string> = {
  css: "css",
  js: "js",
  jsx: "jsx",
  ts: "ts",
  tsx: "tsx",
  json: "json",
  python: "py",
  py: "py",
  bash: "sh",
  sh: "sh",
  sql: "sql",
  rust: "rs",
  go: "go",
  java: "java",
  kotlin: "kt",
  swift: "swift",
  php: "php",
  ruby: "rb",
  yaml: "yaml",
  yml: "yaml"
}

const extensionFor = (artifact: ChatArtifact): string => {
  if (artifact.kind === "html") return "html"
  if (artifact.kind === "svg") return "svg"
  if (artifact.kind === "mermaid") return "mmd"
  return CODE_EXTENSIONS[artifact.language] ?? "txt"
}

const mimeFor = (artifact: ChatArtifact): string => {
  if (artifact.kind === "html") return "text/html"
  if (artifact.kind === "svg") return "image/svg+xml"
  if (artifact.kind === "code" && artifact.language === "json") {
    return "application/json"
  }
  return "text/plain"
}

/**
 * Derive a safe, kind-appropriate filename from the artifact title. Strips path
 * separators and characters the download APIs reject, collapses whitespace, and
 * always appends the correct extension.
 */
export const artifactFileName = (artifact: ChatArtifact): string => {
  // Trim after slicing too: a 64-char cut can land inside a dash run.
  const base =
    artifact.title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 64)
      .replace(/-+$/, "") || "artifact"
  return `${base}.${extensionFor(artifact)}`
}

/**
 * Save a single artifact to a file. Prefers the `downloads` API (requesting the
 * optional permission on this user gesture); falls back to an anchor download if
 * the permission is unavailable or denied so the action never silently no-ops.
 */
export const downloadArtifact = async (
  artifact: ChatArtifact
): Promise<void> => {
  const filename = artifactFileName(artifact)
  const blob = new Blob([artifact.content], { type: mimeFor(artifact) })

  // Top-level guard: call sites invoke this as `void downloadArtifact(...)`, so a
  // rejection from the permission calls or the anchor fallback would otherwise be
  // swallowed. Log it instead of failing silently.
  try {
    const granted =
      (await hasPermission("downloads")) ||
      (await requestPermission("downloads"))

    if (granted && typeof browser.downloads?.download === "function") {
      const url = URL.createObjectURL(blob)
      try {
        await browser.downloads.download({ url, filename, saveAs: true })
        // Revoke once the download has had time to start reading the blob;
        // revoking synchronously can abort the transfer in some browsers.
        setTimeout(() => URL.revokeObjectURL(url), 60_000)
        return
      } catch {
        URL.revokeObjectURL(url)
        // fall through to the anchor fallback below
      }
    }

    downloadFile(blob, filename)
  } catch (error) {
    logger.error("Artifact download failed", "downloadArtifact", { error })
  }
}
