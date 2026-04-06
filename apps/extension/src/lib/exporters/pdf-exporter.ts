import type { TFunction } from "i18next"

import type { ChatMessage, ChatSession } from "@/types"

import { createMarkdownParser, parseMessageContent } from "./markdown-utils"
import { getPdfStyles } from "./styles"
import type { Exporter, ExportOptions } from "./types"

const renderPdf = async (html: string, filename: string) => {
  localStorage.setItem("print_html", html)
  localStorage.setItem("print_filename", filename)

  const printPageUrl = chrome.runtime.getURL("print.html")
  const printWindow = window.open(printPageUrl, "_blank")

  if (!printWindow) {
    localStorage.removeItem("print_html")
    localStorage.removeItem("print_filename")
    throw new Error(
      "Failed to open print window. Please check if popups are blocked."
    )
  }
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
