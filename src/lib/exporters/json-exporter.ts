import type { TFunction } from "i18next"

import type { ChatSession } from "@/types"

import type { Exporter, ExportOptions } from "./types"
import { downloadFile } from "./utils"

export const jsonExporter: Exporter = {
  exportSession: (
    session: ChatSession,
    _t: TFunction,
    options?: ExportOptions
  ) => {
    const blob = new Blob([JSON.stringify(session, null, 2)], {
      type: "application/json"
    })
    downloadFile(
      blob,
      options?.fileName || `${session.title || "chat-session"}.json`
    )
  },

  exportAllSessions: (sessions: ChatSession[], _t: TFunction) => {
    const blob = new Blob([JSON.stringify(sessions, null, 2)], {
      type: "application/json"
    })
    downloadFile(blob, "all-chat-sessions.json")
  }
}
