import type { TFunction } from "i18next"

import type { ChatMessage, ChatSession } from "@/types"

export type ExportFormat = "json" | "pdf" | "markdown" | "text"

export interface ExportOptions {
  fileName?: string
}

export interface Exporter {
  exportSession: (
    session: ChatSession,
    t: TFunction,
    options?: ExportOptions
  ) => Promise<void> | void
  exportAllSessions: (
    sessions: ChatSession[],
    t: TFunction
  ) => Promise<void> | void
  exportMessage: (
    message: ChatMessage,
    t: TFunction,
    options?: ExportOptions
  ) => Promise<void> | void
}
