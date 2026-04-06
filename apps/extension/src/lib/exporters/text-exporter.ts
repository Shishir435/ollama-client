import type { TFunction } from "i18next"

import type { ChatMessage, ChatSession } from "@/types"

import type { Exporter, ExportOptions } from "./types"
import { downloadFile } from "./utils"

const formatSession = (session: ChatSession, t: TFunction): string => {
  const title = `${session.title || t("sessions.export.default_title")}\n${"=".repeat(20)}\n\n`
  const messages = session.messages
    .map((msg) => {
      const role =
        msg.role === "user"
          ? t("sessions.export.role_user")
          : t("sessions.export.role_assistant")
      return `${role}:\n${msg.content}\n`
    })
    .join("\n----------------------------------------\n\n")
  return title + messages
}

export const textExporter: Exporter = {
  exportSession: (
    session: ChatSession,
    t: TFunction,
    options?: ExportOptions
  ) => {
    const filename =
      options?.fileName ||
      `${session.title || t("sessions.export.default_title")}.txt`
    const content = formatSession(session, t)
    const blob = new Blob([content], { type: "text/plain" })
    downloadFile(blob, filename)
  },

  exportAllSessions: (sessions: ChatSession[], t: TFunction) => {
    const content = sessions
      .map((session) => formatSession(session, t))
      .join("\n\n========================================\n\n")
    const blob = new Blob([content], { type: "text/plain" })
    downloadFile(blob, "all-chat-sessions.txt")
  },

  exportMessage: (
    message: ChatMessage,
    t: TFunction,
    options?: ExportOptions
  ) => {
    const role =
      message.role === "user"
        ? t("sessions.export.role_user")
        : t("sessions.export.role_assistant")

    const content = `${role}:\n${message.content}\n`
    const filename =
      options?.fileName || `message-${message.id || "export"}.txt`
    const blob = new Blob([content], { type: "text/plain" })
    downloadFile(blob, filename)
  }
}
