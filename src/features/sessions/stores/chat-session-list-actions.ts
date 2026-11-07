import * as repo from "@/lib/repositories/chat-history"
import { requestSessionDelete } from "@/protocol/session-client"
import type { ChatSession, ChatSessionState } from "@/types"
import type { ChatSessionGet, ChatSessionSet } from "./chat-session-store-types"

export const createChatSessionListActions = (
  set: ChatSessionSet,
  get: ChatSessionGet
): Pick<
  ChatSessionState,
  | "setCurrentSessionId"
  | "setHighlightedMessage"
  | "loadSessions"
  | "refreshSessions"
  | "createSession"
  | "deleteSession"
  | "renameSessionTitle"
  | "togglePinSession"
  | "setSessionSystemPrompt"
  | "setSessionTags"
> => ({
  setCurrentSessionId: (id) => {
    set((state) => ({
      currentSessionId: id,
      hasSession: id !== null,
      highlightedMessage: null,
      hasMoreMessages: false,
      sessions: state.sessions.map((session) =>
        session.id !== id && session.messages?.length
          ? { ...session, messages: [] }
          : session
      )
    }))
    if (id) get().loadSessionMessages(id)
  },

  setHighlightedMessage: (message) => set({ highlightedMessage: message }),

  loadSessions: async () => {
    if (get().sessions.length > 0 || get().hydrated) return
    const all = await repo.getAllSessionsOrderedByRecency()
    set({
      sessions: all,
      currentSessionId: all.length > 0 ? all[0].id : null,
      hasSession: all.length > 0,
      hydrated: true
    })
    if (all.length > 0) await get().loadSessionMessages(all[0].id)
  },

  refreshSessions: async () => {
    const all = await repo.getAllSessionsOrderedByRecency()
    const previousCurrent = get().currentSessionId
    const stillExists = all.some((s) => s.id === previousCurrent)
    const nextCurrent = stillExists
      ? previousCurrent
      : all.length > 0
        ? all[0].id
        : null
    set({
      sessions: all,
      currentSessionId: nextCurrent,
      hasSession: all.length > 0,
      hydrated: true
    })
    if (nextCurrent) await get().loadSessionMessages(nextCurrent)
  },

  createSession: async () => {
    const id = crypto.randomUUID()
    const now = Date.now()
    const newSession: ChatSession = {
      id,
      title: "New Chat",
      createdAt: now,
      updatedAt: now,
      messages: [],
      currentLeafId: undefined
    }
    await repo.addSession(newSession)
    set((state) => ({
      sessions: [
        newSession,
        ...state.sessions.map((session) =>
          session.messages?.length ? { ...session, messages: [] } : session
        )
      ],
      highlightedMessage: null,
      hasMoreMessages: false,
      currentSessionId: id,
      hasSession: true
    }))
    return id
  },

  deleteSession: async (id: string) => {
    /**
     * The background owns the whole delete — runs, rows, files and vectors —
     * so a panel closed straight after this call cannot leave it half-done.
     * Called first, before anything here awaits: the request is posted
     * synchronously, which is what lets the Undo window commit from
     * `pagehide`.
     */
    await requestSessionDelete(id)
    let switchedCurrent = false
    set((state) => {
      const remaining = state.sessions.filter((s) => s.id !== id)
      if (state.currentSessionId !== id) return { sessions: remaining }
      switchedCurrent = true
      return {
        sessions: remaining.map((session, index) =>
          index !== 0 && session.messages?.length
            ? { ...session, messages: [] }
            : session
        ),
        highlightedMessage: null,
        hasMoreMessages: false,
        currentSessionId: remaining.length > 0 ? remaining[0].id : null,
        hasSession: remaining.length > 0
      }
    })
    const newCurrentId = get().currentSessionId
    if (switchedCurrent && newCurrentId)
      await get().loadSessionMessages(newCurrentId)
  },

  renameSessionTitle: async (id: string, title: string) => {
    await repo.updateSession(id, { title })
    set((state) => ({
      sessions: state.sessions.map((s) => (s.id === id ? { ...s, title } : s))
    }))
  },

  togglePinSession: async (id: string) => {
    const current = get().sessions.find((s) => s.id === id)
    if (!current) return
    const pinned = !current.pinned
    await repo.updateSession(id, { pinned })
    set((state) => ({
      sessions: state.sessions.map((s) => (s.id === id ? { ...s, pinned } : s))
    }))
  },

  setSessionSystemPrompt: async (id: string, systemPrompt: string) => {
    // Empty string clears the override (falls back to the model's prompt).
    const trimmed = systemPrompt.trim()
    const value = trimmed.length > 0 ? trimmed : undefined
    await repo.updateSession(id, { systemPrompt: value })
    set((state) => ({
      sessions: state.sessions.map((s) =>
        s.id === id ? { ...s, systemPrompt: value } : s
      )
    }))
  },

  setSessionTags: async (id: string, tags: string[]) => {
    const normalized = Array.from(
      new Set(tags.map((tag) => tag.trim()).filter(Boolean))
    ).slice(0, 12)
    await repo.updateSession(id, { tags: normalized })
    set((state) => ({
      sessions: state.sessions.map((session) =>
        session.id === id ? { ...session, tags: normalized } : session
      )
    }))
  }
})
