import { browser } from "@/lib/browser-api"
import { hasPermission } from "@/lib/permissions"
import type { ToolContext, ToolDefinition, ToolResult } from "../types"

/**
 * `save_artifact` (0.11.16) — lets the model persist text it generated (code,
 * markdown, HTML, SVG, JSON, a diagram, …) to a file the user picks a location
 * for. The counterpart to the human-click artifact download (0.11.13): there the
 * user saves; here the model can, when asked.
 *
 * Runs in the background service worker, which has no DOM and no
 * `URL.createObjectURL` — so it can't reuse `downloadArtifact` (anchor / blob
 * URL). It writes via a `data:` URL through `browser.downloads.download`, which
 * the downloads API accepts from a worker.
 *
 * The native Save-As dialog is the consent gate: the model never silently writes
 * to disk, and canceling the dialog surfaces back to the model as an error. The
 * optional `downloads` permission must already be granted (a tool can't prompt
 * for it — there's no user gesture in the loop).
 */

/** MIME type by file extension; falls back to text/plain for unknown text. */
const MIME_BY_EXTENSION: Record<string, string> = {
  txt: "text/plain",
  md: "text/markdown",
  markdown: "text/markdown",
  html: "text/html",
  htm: "text/html",
  svg: "image/svg+xml",
  json: "application/json",
  csv: "text/csv",
  tsv: "text/tab-separated-values",
  xml: "application/xml",
  yaml: "text/yaml",
  yml: "text/yaml",
  mmd: "text/plain",
  css: "text/css",
  js: "text/javascript",
  mjs: "text/javascript",
  jsx: "text/plain",
  ts: "text/plain",
  tsx: "text/plain",
  py: "text/x-python",
  sh: "text/x-shellscript",
  sql: "application/sql",
  rs: "text/plain",
  go: "text/plain",
  java: "text/plain",
  kt: "text/plain",
  swift: "text/plain",
  php: "text/x-php",
  rb: "text/x-ruby",
  c: "text/x-c",
  h: "text/x-c",
  cpp: "text/x-c"
}

/**
 * Reduce a model-supplied name to a safe, single-segment filename with an
 * extension. Strips any path, drops characters the downloads API rejects, and
 * caps the length so an over-long title can't break the save.
 */
export const sanitizeArtifactFilename = (raw: string): string => {
  const base = raw.split(/[\\/]/).pop() ?? ""
  // Keep Unicode letters/digits so meaningful names (données.csv, 报告.md) survive;
  // collapse only path separators, control chars, and punctuation the downloads
  // API rejects. The `u` flag is required for the \p{...} classes.
  const cleaned = base
    .replace(/[^\p{L}\p{N}._-]+/gu, "-")
    .replace(/^[-.]+|[-.]+$/g, "")
    .slice(0, 100)
    .replace(/[-.]+$/, "")
  const safe = cleaned || "artifact"
  return safe.includes(".") ? safe : `${safe}.txt`
}

const mimeForFilename = (filename: string): string => {
  const ext = filename.split(".").pop()?.toLowerCase() ?? "txt"
  return MIME_BY_EXTENSION[ext] ?? "text/plain"
}

/**
 * Cap on raw content length. Generous but finite — keeps an unusually large model
 * output from building a multi-MB data URL that fails with an opaque browser
 * error instead of a clear, actionable one. Measured in characters (≈ an upper
 * bound on the post-encode byte size for typical text).
 */
const MAX_CONTENT_CHARS = 25_000_000

export const saveArtifactDefinition: ToolDefinition = {
  name: "save_artifact",
  description:
    "Save text content you generated (code, markdown, HTML, SVG, JSON, a Mermaid diagram, etc.) to a file on the user's device. The user gets a Save dialog to choose where it goes. ONLY call this when the user's most recent request explicitly asks to save, download, or export a file. Do NOT call it proactively or as a side effect of another task — for example, do not save a note when the user only asked to set a reminder, summarize, or answer a question. When in doubt, don't save. Provide a filename with an appropriate extension (e.g. 'report.md', 'snippet.ts', 'diagram.svg') and the full file content.",
  displayNameKey: "chat.reasoning.trace.save_artifact",
  category: "system",
  iconKey: "download",
  risk: "medium",
  cacheable: false,
  runtime: { parallelizable: false, timeoutMs: 15_000 },
  parameters: {
    type: "object",
    properties: {
      filename: {
        type: "string",
        description:
          "File name including extension, e.g. 'report.md', 'snippet.ts', 'diagram.svg'."
      },
      content: {
        type: "string",
        description: "The full text content to write to the file."
      }
    },
    required: ["filename", "content"]
  }
}

export const runSaveArtifact = async (
  args: Record<string, unknown>,
  _ctx: ToolContext
): Promise<ToolResult> => {
  const content = typeof args.content === "string" ? args.content : ""
  if (!content) {
    return {
      content: "save_artifact requires non-empty content.",
      isError: true
    }
  }

  if (content.length > MAX_CONTENT_CHARS) {
    return {
      content: `Content is too large to save via this tool (${(content.length / 1_000_000).toFixed(1)}M characters). Split it into smaller files.`,
      isError: true
    }
  }

  const filename = sanitizeArtifactFilename(
    typeof args.filename === "string" ? args.filename : ""
  )

  // The tool can't request the permission (no user gesture in the loop). If it's
  // off, tell the user where to enable it rather than failing opaquely.
  if (!(await hasPermission("downloads"))) {
    return {
      content:
        "Downloads permission is required to save files. Enable it in Settings → Permissions, then try again.",
      isError: true
    }
  }

  if (typeof browser.downloads?.download !== "function") {
    return {
      content: "Saving files is not supported in this browser.",
      isError: true
    }
  }

  try {
    const url = `data:${mimeForFilename(filename)};charset=utf-8,${encodeURIComponent(content)}`
    const downloadId = await browser.downloads.download({
      url,
      filename,
      saveAs: true
    })

    // Some browsers resolve with an undefined id (instead of rejecting) when the
    // user dismisses the Save dialog.
    if (downloadId === undefined || downloadId === null) {
      return {
        content: `Save of "${filename}" was canceled.`,
        isError: true
      }
    }

    return {
      content: `Saved "${filename}" (${content.length} characters) via the browser download manager.`
    }
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    return { content: `Could not save file: ${reason}`, isError: true }
  }
}
