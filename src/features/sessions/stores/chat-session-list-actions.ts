import { forgetAgentRuns } from "@/lib/agent-run-events"
import { deleteVectors } from "@/lib/embeddings/vector-store"
import { logger } from "@/lib/logger"
import * as repo from "@/lib/repositories/chat-history"
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
    set({ currentSessionId: id, hasSession: id !== null })
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
      sessions: [newSession, ...state.sessions],
      currentSessionId: id,
      hasSession: true
    }))
    return id
  },

  deleteSession: async (id: string) => {
    /*
     * First, and awaited to completion rather than to delivery: the runs of
     * this chat are stopped and deleted with it, and a run told after its rows
     * have gone has already spent steps on a conversation that no longer
     * exists. The background answers when the cleanup has finished, so the row
     * below is removed after the stops, not alongside them.
     *
     * What this first pass cannot close on its own is a run started between
     * its answer and the delete — the panel is a separate context and nothing
     * here can hold it. The second pass below is what closes it.
     */
    await forgetAgentRuns({ sessionId: id })
    await repo.deleteSessionRow(id)
    await repo.deleteMessagesBySession(id)
    await repo.deleteFilesBySession(id)
    /*
     * Asked again, now that the session is gone, and this is what makes the
     * window above empty rather than merely small. A run is linked in the same
     * transaction that reads the session, so once this row is deleted no new
     * run can claim this chat — a start racing the delete gets the unlinked
     * fallback, which belongs to no conversation and takes nothing with it.
     * Every run that did claim it is therefore already written, and this pass
     * stops and collects all of them.
     *
     * Two passes rather than a lock spanning both contexts: the first is what
     * stops a run before its rows are taken away, and the second is what
     * guarantees none was added behind it.
     */
    await forgetAgentRuns({ sessionId: id })
    try {
      await deleteVectors({ sessionId: id, type: "chat" })
    } catch (error) {
      logger.error("Failed to delete session embeddings", "chatSessionStore", {
        error
      })
    }
    set((state) => {
      const remaining = state.sessions.filter((s) => s.id !== id)
      return {
        sessions: remaining,
        currentSessionId: remaining.length > 0 ? remaining[0].id : null,
        hasSession: remaining.length > 0
      }
    })
    const newCurrentId = get().currentSessionId
    if (newCurrentId) await get().loadSessionMessages(newCurrentId)
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
