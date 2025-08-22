import Dexie, { type Table } from "dexie"

import type { ChatSession } from "@/types"

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
