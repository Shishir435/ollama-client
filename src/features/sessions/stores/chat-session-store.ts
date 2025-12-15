import { useEffect } from "react"

import { create } from "zustand"
import { useShallow } from "zustand/react/shallow"

import { CHAT_PAGINATION_LIMIT } from "@/lib/constants"
import { db } from "@/lib/db"
import { deleteVectors } from "@/lib/embeddings/vector-store"
import { logger } from "@/lib/logger"
import type {
  ChatMessage,
  ChatSession,
  ChatSessionState,
  FileAttachment
} from "@/types"

export const chatSessionStore = create<ChatSessionState>((set, get) => ({
  sessions: [],
  currentSessionId: null,
  hasSession: false,
  hydrated: false,
  highlightedMessage: null,
  hasMoreMessages: false,

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
      .reverse()
      .sortBy("timestamp")
      .then((msgs) => msgs.slice(0, CHAT_PAGINATION_LIMIT))

    const hasMore = messages.length === CHAT_PAGINATION_LIMIT

    const messageIds = messages.map((m) => m.id as number)
    const files = await db.files.where("messageId").anyOf(messageIds).toArray()

    // O(F) - Create lookup map for files
    const filesByMessageId = new Map<number, FileAttachment[]>()
    for (const file of files) {
      if (file.messageId) {
        const existing = filesByMessageId.get(file.messageId) || []
        existing.push(file)
        filesByMessageId.set(file.messageId, existing)
      }
    }

    // O(M) - Map messages using lookup
    const messagesWithFiles = messages.map((msg) => ({
      ...msg,
      attachments: msg.id ? filesByMessageId.get(msg.id) || [] : []
    }))

    const sortedMessages = messagesWithFiles.sort(
      (a, b) => (a.timestamp || 0) - (b.timestamp || 0)
    )

    set((state) => ({
      hasMoreMessages: hasMore,
      sessions: state.sessions.map((s) =>
        s.id === sessionId ? { ...s, messages: sortedMessages } : s
      )
    }))
  },

  loadMoreMessages: async () => {
    const { currentSessionId, sessions, hasMoreMessages } = get()
    if (!currentSessionId || !hasMoreMessages) return

    const currentSession = sessions.find((s) => s.id === currentSessionId)
    if (
      !currentSession ||
      !currentSession.messages ||
      currentSession.messages.length === 0
    )
      return

    const oldestMessage = currentSession.messages[0]
    const oldestTimestamp = oldestMessage.timestamp || 0

    const messages = await db.messages
      .where("[sessionId+timestamp]")
      .between(
        [currentSessionId, 0],
        [currentSessionId, oldestTimestamp],
        false,
        false
      ) // 0 to oldestTimestamp, exclusive end
      .reverse()
      .limit(CHAT_PAGINATION_LIMIT)
      .toArray()

    const hasMore = messages.length === CHAT_PAGINATION_LIMIT

    const messageIds = messages.map((m) => m.id as number)
    const files = await db.files.where("messageId").anyOf(messageIds).toArray()

    const filesByMessageId = new Map<number, FileAttachment[]>()
    for (const file of files) {
      if (file.messageId) {
        const existing = filesByMessageId.get(file.messageId) || []
        existing.push(file)
        filesByMessageId.set(file.messageId, existing)
      }
    }

    const messagesWithFiles = messages.map((msg) => ({
      ...msg,
      attachments: msg.id ? filesByMessageId.get(msg.id) || [] : []
    }))

    const sortedNewMessages = messagesWithFiles.sort(
      (a, b) => (a.timestamp || 0) - (b.timestamp || 0)
    )

    set((state) => ({
      hasMoreMessages: hasMore,
      sessions: state.sessions.map((s) =>
        s.id === currentSessionId
          ? { ...s, messages: [...sortedNewMessages, ...(s.messages || [])] }
          : s
      )
    }))
  },

  ensureMessageLoaded: async (sessionId: string, timestamp: number) => {
    const { sessions } = get()
    const session = sessions.find((s) => s.id === sessionId)

    // If session not loaded or no messages, just load initial
    if (!session || !session.messages || session.messages.length === 0) {
      await get().loadSessionMessages(sessionId)
      // Recalculate session after load
      const updatedSession = get().sessions.find((s) => s.id === sessionId)
      // If still no messages or target is older than oldest, we might need to load more?
      // Actually, loadSessionMessages loads the *latest*.
      // If target is old, we still need to check below.
      if (!updatedSession?.messages?.length) return
    }

    const currentSession = get().sessions.find((s) => s.id === sessionId)
    if (!currentSession?.messages?.length) return

    const oldestLoaded = currentSession.messages[0].timestamp || 0

    // If target is newer than oldest loaded, it's already here (assuming contiguous list from bottom)
    if (timestamp >= oldestLoaded) return

    // Target is older. We need to load everything from target up to oldestLoaded.
    // We add a small buffer (e.g. 1ms? or just use exact) to avoiding duplicates with 'exclusive' ranges
    const messages = await db.messages
      .where("[sessionId+timestamp]")
      .between([sessionId, 0], [sessionId, oldestLoaded], false, false) // 0 to oldestLoaded (exclusive)
      .toArray()

    // Since we fetched from 0 (beginning of time) to current oldest, we have loaded all history.
    // Since we fetched from 0 (beginning of time) to current oldest, we have loaded all history.
    // const hasMore = false

    const messageIds = messages.map((m) => m.id as number)
    const files = await db.files.where("messageId").anyOf(messageIds).toArray()

    const filesByMessageId = new Map<number, FileAttachment[]>()
    for (const file of files) {
      if (file.messageId) {
        const existing = filesByMessageId.get(file.messageId) || []
        existing.push(file)
        filesByMessageId.set(file.messageId, existing)
      }
    }

    const messagesWithFiles = messages.map((msg) => ({
      ...msg,
      attachments: msg.id ? filesByMessageId.get(msg.id) || [] : []
    }))

    const sortedNewMessages = messagesWithFiles.sort(
      (a, b) => (a.timestamp || 0) - (b.timestamp || 0)
    )

    set((state) => ({
      hasMoreMessages: false, // We loaded everything down to 0
      sessions: state.sessions.map((s) =>
        s.id === sessionId
          ? { ...s, messages: [...sortedNewMessages, ...(s.messages || [])] }
          : s
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
  },

  addMessage: async (sessionId: string, message: ChatMessage) => {
    // 1. Add to DB
    const timestamp = message.timestamp || Date.now()
    const msgWithSession = {
      ...message,
      sessionId,
      timestamp
    }
    const id = (await db.messages.add(msgWithSession)) as number

    // 2. Add attachments if any
    if (message.attachments && message.attachments.length > 0) {
      const files = message.attachments.map((f) => ({
        ...f,
        messageId: id,
        sessionId
      }))
      await db.files.bulkAdd(files)
    }

    // 3. Update session timestamp
    const updatedAt = Date.now()
    await db.sessions.update(sessionId, { updatedAt })

    // 4. Update local state
    set((state) => ({
      sessions: state.sessions.map((s) => {
        if (s.id === sessionId) {
          const newMsg = { ...message, id, timestamp }
          return {
            ...s,
            messages: [...(s.messages || []), newMsg],
            updatedAt
          }
        }
        return s
      })
    }))

    return id
  },

  updateMessage: async (
    messageId: number,
    updates: Partial<ChatMessage>,
    skipDb = false
  ) => {
    // 1. Update DB (if not skipped)
    if (!skipDb) {
      await db.messages.update(messageId, updates)
    }

    // 2. Update local state
    set((state) => ({
      sessions: state.sessions.map((s) => ({
        ...s,
        messages: s.messages?.map((m) =>
          m.id === messageId ? { ...m, ...updates } : m
        )
      }))
    }))
  },

  deleteMessage: async (messageId: number) => {
    // 1. Delete from DB
    await db.messages.delete(messageId)
    await db.files.where("messageId").equals(messageId).delete()

    // 2. Update local state
    set((state) => ({
      sessions: state.sessions.map((s) => ({
        ...s,
        messages: s.messages?.filter((m) => m.id !== messageId)
      }))
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
      hasMoreMessages: s.hasMoreMessages,
      loadMoreMessages: s.loadMoreMessages,
      ensureMessageLoaded: s.ensureMessageLoaded,
      highlightedMessage: s.highlightedMessage,
      setHighlightedMessage: s.setHighlightedMessage,
      addMessage: s.addMessage,
      updateMessage: s.updateMessage,
      deleteMessage: s.deleteMessage
    }))
  )
  useEffect(() => {
    if (!store.sessions.length && !store.hasSession) {
      store.loadSessions()
    }
  }, [store.hasSession, store.loadSessions, store.sessions.length])
  return store
}
