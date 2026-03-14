import type { TFunction } from "i18next"

import type { ChatMessage, ChatSession } from "@/types"

import { createMarkdownParser, parseMessageContent } from "./markdown-utils"
import { getPdfStyles } from "./styles"
import type { Exporter, ExportOptions } from "./types"

const renderPdf = async (html: string, filename: string) => {
  const scrollbarWidth =
    window.innerWidth - document.documentElement.clientWidth
  const lockStyle = document.createElement("style")
  lockStyle.id = "pdf-export-lock"
  lockStyle.textContent = `
    html.pdf-export-lock,
    body.pdf-export-lock {
      overflow-y: scroll !important;
      padding-right: ${Math.max(0, scrollbarWidth)}px !important;
    }
  `
  document.head.appendChild(lockStyle)
  document.documentElement.classList.add("pdf-export-lock")
  document.body.classList.add("pdf-export-lock")

  document.documentElement.style.scrollbarGutter = "stable both-edges"
  document.body.style.scrollbarGutter = "stable both-edges"

  const iframe = document.createElement("iframe")
  iframe.setAttribute(
    "style",
    "position:fixed;left:-9999px;top:-9999px;width:0;height:0;border:0;opacity:0;pointer-events:none;"
  )
  document.body.appendChild(iframe)

  const doc = iframe.contentDocument
  if (!doc) {
    iframe.remove()
    throw new Error("Failed to initialize PDF renderer")
  }

  doc.open()
  doc.write(
    `<!doctype html><html><head><meta charset="utf-8" /></head><body>${html}</body></html>`
  )
  doc.close()

  const html2pdf = (await import("html2pdf.js")).default

  return html2pdf()
    .from(doc.body)
    .set({
      margin: [15, 15, 15, 15],
      filename,
      html2canvas: {
        scale: 2,
        useCORS: true,
        letterRendering: true,
        allowTaint: false
      },
      jsPDF: {
        unit: "mm",
        format: "a4",
        orientation: "portrait",
        compress: true
      },
      pagebreak: {
        mode: ["avoid-all", "css", "legacy"]
      }
    })
    .save()
    .finally(() => {
      iframe.remove()
      document.documentElement.classList.remove("pdf-export-lock")
      document.body.classList.remove("pdf-export-lock")
      document.documentElement.style.scrollbarGutter = ""
      document.body.style.scrollbarGutter = ""
      lockStyle.remove()
    })
}

export const pdfExporter: Exporter = {
  exportSession: (
    session: ChatSession,
    t: TFunction,
    options?: ExportOptions
  ) => {
    const md = createMarkdownParser()
    const html = `
      ${getPdfStyles()}
      <div class="chat-container">
        <h1 class="chat-title">${session.title || t("sessions.export.default_title")}</h1>
        ${session.messages
          .map(
            (msg) => `
            <div class="message ${msg.role === "user" ? "user-message" : "ai-message"}">
              <div class="message-header">${msg.role === "user" ? t("sessions.export.role_user") : t("sessions.export.role_assistant")}</div>
              <div class="message-content">
                ${parseMessageContent(msg.content, md)}
              </div>
            </div>
            `
          )
          .join("")}
      </div>
    `

    const filename =
      options?.fileName ||
      `${session.title || t("sessions.export.default_title")}.pdf`

    void renderPdf(html, filename)
  },

  exportAllSessions: (sessions: ChatSession[], t: TFunction) => {
    const md = createMarkdownParser()
    const html = `
      ${getPdfStyles()}
      <div class="chat-container">
        <h1 class="chat-title">${t("sessions.export.all_sessions_title")}</h1>
        ${sessions
          .map(
            (session, index) => `
            ${index > 0 ? '<hr class="session-separator" />' : ""}
            <h2 class="chat-title">${session.title || `Chat Session ${index + 1}`}</h2>
            ${session.messages
              .map(
                (msg) => `
                <div class="message ${msg.role === "user" ? "user-message" : "ai-message"}">
                  <div class="message-header">${msg.role === "user" ? t("sessions.export.role_user") : t("sessions.export.role_assistant")}</div>
                  <div class="message-content">
                    ${parseMessageContent(msg.content, md)}
                  </div>
                </div>
                `
              )
              .join("")}
            `
          )
          .join("")}
      </div>
    `

    void renderPdf(html, "all-chat-sessions.pdf")
  },

  exportMessage: (
    message: ChatMessage,
    t: TFunction,
    options?: ExportOptions
  ) => {
    const md = createMarkdownParser()
    const html = `
      ${getPdfStyles()}
      <div class="chat-container">
        <div class="message ${message.role === "user" ? "user-message" : "ai-message"}">
          <div class="message-header">${message.role === "user" ? t("sessions.export.role_user") : t("sessions.export.role_assistant")}</div>
          <div class="message-content">
            ${parseMessageContent(message.content, md)}
          </div>
        </div>
      </div>
    `

    const filename =
      options?.fileName || `message-${message.id || "export"}.pdf`

    void renderPdf(html, filename)
  }
}
