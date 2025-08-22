import { v4 as uuidv4 } from "uuid"
import { create } from "zustand"

import { db } from "@/lib/db"
import type { ChatSession, ChatSessionState } from "@/types"

export const chatSessionStore = create<ChatSessionState>((set, get) => ({
  sessions: [],
  currentSessionId: null,
  hasSession: false,

  setCurrentSessionId: (id) =>
    set({ currentSessionId: id, hasSession: id !== null }),

  loadSessions: async () => {
    const all = await db.sessions.orderBy("updatedAt").reverse().toArray()
    set({
      sessions: all,
      currentSessionId: all.length > 0 ? all[0].id : null,
      hasSession: all.length > 0
    })
  },

  createSession: async () => {
    const id = uuidv4()
    const now = Date.now()
    const newSession: ChatSession = {
      id,
      title: "New Chat",
      createdAt: now,
      updatedAt: now,
      messages: []
    }
    await db.sessions.add(newSession)
    set((state) => ({
      sessions: [newSession, ...state.sessions],
      currentSessionId: id,
      hasSession: true
    }))
  },

  deleteSession: async (id: string) => {
    await db.sessions.delete(id)
    set((state) => {
      const remaining = state.sessions.filter((s) => s.id !== id)
      return {
        sessions: remaining,
        currentSessionId: remaining.length > 0 ? remaining[0].id : null,
        hasSession: remaining.length > 0
      }
    })
  },

  renameSessionTitle: async (id: string, title: string) => {
    await db.sessions.update(id, { title })
    set((state) => ({
      sessions: state.sessions.map((s) => (s.id === id ? { ...s, title } : s))
    }))
  },

  updateMessages: async (id: string, messages: ChatSession["messages"]) => {
    const updatedAt = Date.now()
    await db.sessions.update(id, { messages, updatedAt })
    set((state) => ({
      sessions: state.sessions.map((s) =>
        s.id === id ? { ...s, messages, updatedAt } : s
      )
    }))
  }
}))
