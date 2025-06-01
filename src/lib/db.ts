import Dexie, { type Table } from "dexie"

import type { ChatMessage } from "@/types"

export interface ChatSession {
  id: string
  title: string
  createdAt: number
  updatedAt: number
  messages: ChatMessage[]
}

class ChatDatabase extends Dexie {
  sessions!: Table<ChatSession>

  constructor() {
    super("ChatDatabase")
    this.version(1).stores({
      sessions: "id, createdAt, updatedAt"
    })
  }
}

export const db = new ChatDatabase()
