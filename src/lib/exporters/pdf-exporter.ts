import html2pdf from "html2pdf.js"
import type { TFunction } from "i18next"

import type { ChatSession } from "@/types"

import { createMarkdownParser, parseMessageContent } from "./markdown-utils"
import { getPdfStyles } from "./styles"
import type { Exporter, ExportOptions } from "./types"

export const pdfExporter: Exporter = {
  exportSession: (
    session: ChatSession,
    t: TFunction,
    options?: ExportOptions
  ) => {
    const md = createMarkdownParser()
    const element = document.createElement("div")
    element.innerHTML = `
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

    html2pdf()
      .from(element)
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
  },

  exportAllSessions: (sessions: ChatSession[], t: TFunction) => {
    const md = createMarkdownParser()
    const element = document.createElement("div")
    element.innerHTML = `
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

    html2pdf()
      .from(element)
      .set({
        margin: [15, 15, 15, 15],
        filename: "all-chat-sessions.pdf",
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
  }
}
