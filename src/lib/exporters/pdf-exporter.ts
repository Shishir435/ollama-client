import type { TFunction } from "i18next"

import { STORAGE_KEYS } from "@/lib/constants"
import { createAppError } from "@/lib/error-utils"
import { getPlasmoStoredValue } from "@/lib/plasmo-global-storage"
import type { ChatMessage, ChatSession, ImageAttachment } from "@/types"

import { escapeHtml, sanitizeExportFragment } from "./export-sanitizer"
import { createMarkdownParser, parseMessageContent } from "./markdown-utils"
import { type PrintJobPayload, printJobKey } from "./print-job"
import { getPdfStyles } from "./styles"
import type { Exporter, ExportOptions } from "./types"

/**
 * Whether the user opted in to loading remote http(s) images in print/PDF
 * export. Off by default: printing a chat must not fire requests to
 * third-party servers embedded in message content.
 */
const allowRemoteExportImages = async (): Promise<boolean> =>
  (await getPlasmoStoredValue<boolean>(
    STORAGE_KEYS.EXPORT.ALLOW_REMOTE_IMAGES
  )) === true

const renderPdf = async (
  html: string,
  filename: string,
  t: TFunction
): Promise<void> => {
  const allowRemoteImages = await allowRemoteExportImages()
  // The print page reads this fragment back out of localStorage and injects
  // it via innerHTML, so the COMPLETE assembled document is sanitized here
  // (titles included, not just message bodies) and re-sanitized on the print
  // side with the same shared config.
  const safeHtml = sanitizeExportFragment(html, {
    allowRemoteImages,
    blockedImageLabel: t("sessions.export.remote_image_blocked")
  })
  // One payload key per export: concurrent exports must not overwrite or
  // clear each other's documents, so each print window is handed its own
  // job id and consumes only its own payload.
  const jobId = crypto.randomUUID()
  const jobKey = printJobKey(jobId)
  localStorage.setItem(
    jobKey,
    JSON.stringify({
      html: safeHtml,
      filename,
      allowRemoteImages,
      createdAt: Date.now()
    } satisfies PrintJobPayload)
  )

  const printPageUrl = `${chrome.runtime.getURL("print.html")}?job=${jobId}`
  const printWindow = window.open(printPageUrl, "_blank")

  if (!printWindow) {
    localStorage.removeItem(jobKey)
    throw createAppError(
      "Failed to open print window. Please check if popups are blocked.",
      { kind: "validation" }
    )
  }
}

/**
 * Render message-scoped vision images inline as `data:` URIs. Images are stored
 * as raw base64 (no `data:` prefix) plus a separate `mimeType`, so the URI is
 * reassembled here. The whole fragment is DOMPurify-sanitized downstream (with
 * `data:` allowed), so these inert local images survive while the remote-image
 * gate leaves them untouched.
 */
const renderImages = (images?: ImageAttachment[]): string => {
  if (!images?.length) return ""
  return `
    <div class="message-images">
      ${images
        .map((img) => {
          const src = escapeHtml(`data:${img.mimeType};base64,${img.base64}`)
          const alt = escapeHtml(img.fileName ?? "")
          return `<img class="message-image" src="${src}" alt="${alt}" />`
        })
        .join("")}
    </div>`
}

const renderMessage = (
  msg: ChatMessage,
  t: TFunction,
  md: ReturnType<typeof createMarkdownParser>
): string => `
  <div class="message ${msg.role === "user" ? "user-message" : "ai-message"}">
    <div class="message-header">${msg.role === "user" ? t("sessions.export.role_user") : t("sessions.export.role_assistant")}</div>
    <div class="message-content">
      ${renderImages(msg.images)}
      ${parseMessageContent(msg.content, md)}
    </div>
  </div>
  `

export const pdfExporter: Exporter = {
  exportSession: async (
    session: ChatSession,
    t: TFunction,
    options?: ExportOptions
  ) => {
    const md = createMarkdownParser()
    const title = session.title || t("sessions.export.default_title")
    const html = `
      ${getPdfStyles()}
      <div class="chat-container">
        <h1 class="chat-title">${escapeHtml(title)}</h1>
        ${(session.messages ?? []).map((msg) => renderMessage(msg, t, md)).join("")}
      </div>
    `

    const filename =
      options?.fileName ||
      `${session.title || t("sessions.export.default_title")}.pdf`

    await renderPdf(html, filename, t)
  },

  exportAllSessions: async (sessions: ChatSession[], t: TFunction) => {
    const md = createMarkdownParser()
    const html = `
      ${getPdfStyles()}
      <div class="chat-container">
        <h1 class="chat-title">${escapeHtml(t("sessions.export.all_sessions_title"))}</h1>
        ${sessions
          .map(
            (session, index) => `
            ${index > 0 ? '<hr class="session-separator" />' : ""}
            <h2 class="chat-title">${escapeHtml(session.title || `Chat Session ${index + 1}`)}</h2>
            ${(session.messages ?? []).map((msg) => renderMessage(msg, t, md)).join("")}
            `
          )
          .join("")}
      </div>
    `

    await renderPdf(html, "all-chat-sessions.pdf", t)
  },

  exportMessage: async (
    message: ChatMessage,
    t: TFunction,
    options?: ExportOptions
  ) => {
    const md = createMarkdownParser()
    const html = `
      ${getPdfStyles()}
      <div class="chat-container">
        ${renderMessage(message, t, md)}
      </div>
    `

    const filename =
      options?.fileName || `message-${message.id || "export"}.pdf`

    await renderPdf(html, filename, t)
  }
}
