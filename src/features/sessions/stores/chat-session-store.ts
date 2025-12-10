import { useEffect } from "react"

import { create } from "zustand"
import { useShallow } from "zustand/react/shallow"

import { db } from "@/lib/db"
import { deleteVectors } from "@/lib/embeddings/vector-store"
import { logger } from "@/lib/logger"
import type { ChatSession, ChatSessionState } from "@/types"

export const chatSessionStore = create<ChatSessionState>((set, get) => ({
  sessions: [],
  currentSessionId: null,
  hasSession: false,
  hydrated: false,
  highlightedMessage: null,

  setCurrentSessionId: (id) => {
    set({ currentSessionId: id, hasSession: id !== null })
    if (id) {
      get().loadSessionMessages(id)
    }
  },

  setHighlightedMessage: (message) => set({ highlightedMessage: message }),

  loadSessions: async () => {
    if (get().sessions.length > 0 || get().hydrated) return
    // Only load session metadata (no messages)
    const all = await db.sessions.orderBy("updatedAt").reverse().toArray()
    set({
      sessions: all,
      currentSessionId: all.length > 0 ? all[0].id : null,
      hasSession: all.length > 0,
      hydrated: true
    })

    // If there is a current session, load its messages
    if (all.length > 0) {
      await get().loadSessionMessages(all[0].id)
    }
  },

  loadSessionMessages: async (sessionId: string) => {
    if (!sessionId) return
    const messages = await db.messages
      .where("sessionId")
      .equals(sessionId)
      .sortBy("timestamp")
    const files = await db.files.where("sessionId").equals(sessionId).toArray()

    // Reconstruct attachments from files table by matching messageId
    const messagesWithFiles = messages.map((msg) => ({
      ...msg,
      attachments: files.filter((f) => f.messageId === msg.id)
    }))

    set((state) => ({
      sessions: state.sessions.map((s) =>
        s.id === sessionId ? { ...s, messages: messagesWithFiles } : s
      )
    }))
  },

  createSession: async () => {
    const id = crypto.randomUUID()
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
    // Delete messages and files for this session
    await db.messages.where("sessionId").equals(id).delete()
    await db.files.where("sessionId").equals(id).delete()

    // Delete all embeddings for this session
    try {
      await deleteVectors({ sessionId: id, type: "chat" })
    } catch (error) {
      logger.error("Failed to delete session embeddings", "chatSessionStore", {
        error
      })
      // Don't block session deletion if embedding cleanup fails
    }
    set((state) => {
      const remaining = state.sessions.filter((s) => s.id !== id)
      return {
        sessions: remaining,
        currentSessionId: remaining.length > 0 ? remaining[0].id : null,
        hasSession: remaining.length > 0
      }
    })
    // If we switched to a new session, load its messages
    const newCurrentId = get().currentSessionId
    if (newCurrentId) {
      await get().loadSessionMessages(newCurrentId)
    }
  },

  renameSessionTitle: async (id: string, title: string) => {
    await db.sessions.update(id, { title })
    set((state) => ({
      sessions: state.sessions.map((s) => (s.id === id ? { ...s, title } : s))
    }))
  },

  updateMessages: async (id: string, messages: ChatSession["messages"]) => {
    const updatedAt = Date.now()
    await db.sessions.update(id, { updatedAt })

    if (messages && messages.length > 0) {
      // Clear existing messages and files for this session first
      await db.messages.where("sessionId").equals(id).delete()
      await db.files.where("sessionId").equals(id).delete()

      // Save messages first to get their IDs
      const messagesToSave = messages.map((msg) => ({
        ...msg,
        sessionId: id,
        timestamp: msg.timestamp || Date.now()
      }))

      const messageKeys = await db.messages.bulkPut(messagesToSave, {
        allKeys: true
      })

      // Extract and save file attachments with their messageId
      const filesToSave = []
      for (let i = 0; i < messages.length; i++) {
        const msg = messages[i]
        const messageId = messageKeys[i] as number

        if (msg.attachments && msg.attachments.length > 0) {
          for (const file of msg.attachments) {
            filesToSave.push({
              ...file,
              messageId,
              sessionId: id
            })
          }
        }
      }

      if (filesToSave.length > 0) {
        await db.files.bulkPut(filesToSave)
      }
    }

    set((state) => ({
      sessions: state.sessions.map((s) =>
        s.id === id ? { ...s, messages, updatedAt } : s
      )
    }))
  }
}))

export const useChatSessions = () => {
  const store = chatSessionStore(
    useShallow((s) => ({
      sessions: s.sessions,
      currentSessionId: s.currentSessionId,
      hasSession: s.hasSession,
      createSession: s.createSession,
      deleteSession: s.deleteSession,
      updateMessages: s.updateMessages,
      renameSessionTitle: s.renameSessionTitle,
      setCurrentSessionId: s.setCurrentSessionId,
      loadSessions: s.loadSessions,
      loadSessionMessages: s.loadSessionMessages,
      highlightedMessage: s.highlightedMessage,
      setHighlightedMessage: s.setHighlightedMessage
    }))
  )
  useEffect(() => {
    if (!store.sessions.length && !store.hasSession) {
      store.loadSessions()
    }
  }, [store.hasSession, store.loadSessions, store.sessions.length])
  return store
}
