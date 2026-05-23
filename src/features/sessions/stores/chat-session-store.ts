import { useEffect } from "react"

import { create } from "zustand"
import { useShallow } from "zustand/react/shallow"

import {
  buildSiblingsMap,
  collectDescendantIds,
  enrichPathWithSiblingsAndAttachments,
  findLatestLeafDescendant,
  groupFilesByMessageId,
  traversePathFromLeaf,
  traversePathFromLeafWithFetcher
} from "@/features/sessions/lib/message-tree"
import { CHAT_PAGINATION_LIMIT } from "@/lib/constants"
import { deleteVectors } from "@/lib/embeddings/vector-store"
import { logger } from "@/lib/logger"
import * as repo from "@/lib/repositories/chat-history"
import type { ChatMessage, ChatSession, ChatSessionState } from "@/types"

export const chatSessionStore = create<ChatSessionState>((set, get) => ({
  sessions: [],
  currentSessionId: null,
  hasSession: false,
  hydrated: false,
  highlightedMessage: null,
  hasMoreMessages: false,

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
    // Force-bypass the `loadSessions` hydration guard. Used by the
    // startup reconcile migration after it lands additional rows in
    // the backend that this store has already hydrated past.
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

  loadSessionMessages: async (sessionId: string) => {
    const session = await repo.getSession(sessionId)
    if (!session) return

    const allMessages =
      await repo.getMessagesBySessionOrderedByTimestamp(sessionId)

    if (allMessages.length === 0) {
      set((state) => ({
        sessions: state.sessions.map((s) =>
          s.id === sessionId
            ? { ...s, messages: [], currentLeafId: undefined }
            : s
        ),
        hasMoreMessages: false
      }))
      return
    }

    // Pick the leaf: prefer the session's `currentLeafId`, otherwise
    // fall back to the timestamp-latest message.
    const leafId =
      session.currentLeafId ?? allMessages[allMessages.length - 1].id
    if (leafId === undefined) return

    const siblingsMap = buildSiblingsMap(allMessages)
    const { path, hasMore } = traversePathFromLeaf(
      allMessages,
      leafId,
      CHAT_PAGINATION_LIMIT
    )

    const messageIds = path
      .map((m) => m.id)
      .filter((id): id is number => typeof id === "number")
    const files =
      messageIds.length > 0 ? await repo.getFilesByMessageIds(messageIds) : []
    const filesByMessageId = groupFilesByMessageId(files)

    const messagesWithData = enrichPathWithSiblingsAndAttachments(
      path,
      siblingsMap,
      filesByMessageId
    )

    set((state) => ({
      hasMoreMessages: hasMore,
      sessions: state.sessions.map((s) =>
        s.id === sessionId
          ? { ...s, messages: messagesWithData, currentLeafId: leafId }
          : s
      )
    }))
  },

  loadMoreMessages: async () => {
    const { currentSessionId, sessions } = get()
    if (!currentSessionId) return

    const currentSession = sessions.find((s) => s.id === currentSessionId)
    if (!currentSession?.messages?.length) return

    const oldestMsg = currentSession.messages[0]
    const startId = oldestMsg.parentId
    if (startId === undefined) {
      set({ hasMoreMessages: false })
      return
    }

    const { path, hasMore } = await traversePathFromLeafWithFetcher(
      startId,
      CHAT_PAGINATION_LIMIT,
      (id) => repo.getMessage(id)
    )

    const messageIds = path
      .map((m) => m.id)
      .filter((id): id is number => typeof id === "number")
    const files =
      messageIds.length > 0 ? await repo.getFilesByMessageIds(messageIds) : []
    const filesByMessageId = groupFilesByMessageId(files)

    // Look up siblings for the loaded slice: gather candidate parents
    // and walk one step out to find their other children.
    const parentIds = path
      .map((m) => m.parentId)
      .filter((id): id is number | string => id !== undefined)
    let siblingCandidates: ChatMessage[] = []
    if (parentIds.length > 0) {
      siblingCandidates = await repo.getMessagesByParents(parentIds)
    }
    if (path.some((m) => !m.parentId)) {
      const rootSiblings =
        await repo.getRootMessagesForSession(currentSessionId)
      siblingCandidates = [...siblingCandidates, ...rootSiblings]
    }
    const siblingsMap = buildSiblingsMap(siblingCandidates)

    const messagesWithData = enrichPathWithSiblingsAndAttachments(
      path,
      siblingsMap,
      filesByMessageId
    )

    set((state) => ({
      hasMoreMessages: hasMore,
      sessions: state.sessions.map((s) =>
        s.id === currentSessionId
          ? { ...s, messages: [...messagesWithData, ...(s.messages || [])] }
          : s
      )
    }))
  },

  ensureMessageLoaded: async (
    sessionId: string,
    timestamp: number,
    messageId?: number | string
  ) => {
    if (messageId) {
      await get().navigateToNode(sessionId, messageId)
      return
    }

    // Legacy timestamp-based path. If we find a message at that
    // timestamp, navigate to its node; otherwise fall back to loading
    // the active branch.
    try {
      const matches = await repo.getMessagesBySessionAtTimestamp(
        sessionId,
        timestamp
      )
      const firstId = matches[0]?.id
      if (firstId !== undefined) {
        await get().navigateToNode(sessionId, firstId)
        return
      }
    } catch (error) {
      logger.error("Failed to find message by timestamp", "chatSessionStore", {
        error
      })
    }

    await get().loadSessionMessages(sessionId)
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
  },

  deleteSession: async (id: string) => {
    await repo.deleteSessionRow(id)
    await repo.deleteMessagesBySession(id)
    await repo.deleteFilesBySession(id)
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

  // Legacy bulk-update entry point. The current chat flow updates one
  // message at a time through `updateMessage`. Preserved as a no-op
  // boundary so older import/restore paths can still call it without
  // crashing the tree.
  updateMessages: async (_id: string, _messages: ChatSession["messages"]) => {},

  addMessage: async (sessionId: string, message: ChatMessage) => {
    const session = get().sessions.find((s) => s.id === sessionId)
    // Default parent: session's active leaf, or the last on-screen message
    // when the leaf is unset on a freshly-loaded session.
    let parentId: number | string | undefined = session?.currentLeafId
    if (!parentId && session?.messages?.length) {
      parentId = session.messages[session.messages.length - 1].id
    }
    if (message.parentId !== undefined) parentId = message.parentId

    const timestamp = message.timestamp || Date.now()
    const { id: _ignored, ...messageWithoutId } = message
    const id = await repo.addMessage({
      ...messageWithoutId,
      sessionId,
      timestamp,
      parentId
    })

    if (message.attachments && message.attachments.length > 0) {
      await repo.bulkAddFiles(
        message.attachments.map((f) => ({ ...f, messageId: id, sessionId }))
      )
    }

    await repo.updateSession(sessionId, {
      updatedAt: Date.now(),
      currentLeafId: id
    })

    // Recompute the active path so the new message's siblingIds are
    // populated correctly — we cannot do that optimistically without
    // re-running the tree traversal.
    await get().loadSessionMessages(sessionId)

    return id
  },

  updateMessage: async (
    messageId: number,
    updates: Partial<ChatMessage>,
    skipDb = false
  ) => {
    if (!skipDb) {
      await repo.updateMessage(messageId, updates)
      if (updates.content) {
        // Content changed — invalidate any cached embeddings asynchronously.
        deleteVectors({ messageId }).catch((error) => {
          logger.error(
            "Failed to delete outdated embeddings",
            "chatSessionStore",
            { error, messageId }
          )
        })
      }
    }

    set((state) => ({
      sessions: state.sessions.map((s) => ({
        ...s,
        messages: s.messages?.map((m) =>
          m.id === messageId ? { ...m, ...updates } : m
        )
      }))
    }))
  },

  forkMessage: async (
    sessionId: string,
    originalMessageId: number,
    newContent: string
  ) => {
    const originalMsg = await repo.getMessage(originalMessageId)
    if (!originalMsg) return

    const timestamp = Date.now()
    const newId = await repo.addMessage({
      role: originalMsg.role,
      content: newContent,
      sessionId,
      timestamp,
      parentId: originalMsg.parentId,
      model: originalMsg.model
    })

    // The fork becomes the new leaf — any generated response will hang
    // off this new node.
    await repo.updateSession(sessionId, {
      currentLeafId: newId,
      updatedAt: timestamp
    })
    await get().loadSessionMessages(sessionId)
    return newId
  },

  navigateToNode: async (
    sessionId: string,
    nodeId: number | string,
    exact = false
  ) => {
    // `exact=false`: drop to the latest leaf descending from the node so
    // the user sees the most recent state of that branch.
    // `exact=true`: pin to this exact node (used by future fork flows).
    let leafId = nodeId
    if (!exact) {
      const allMessages =
        await repo.getMessagesBySessionOrderedByTimestamp(sessionId)
      leafId = findLatestLeafDescendant(allMessages, nodeId)
    }

    await repo.updateSession(sessionId, { currentLeafId: leafId })
    await get().loadSessionMessages(sessionId)
  },

  deleteMessage: async (messageId: number) => {
    const targetMsg = await repo.getMessage(messageId)
    if (!targetMsg?.sessionId) return

    const { sessionId, parentId: targetParentId } = targetMsg

    const allMessages = await repo.getMessagesBySession(sessionId)
    const toDeleteIds = collectDescendantIds(allMessages, messageId)
    const idsToDelete = Array.from(toDeleteIds)

    // If the current leaf is in the deleted subtree, reset it to the
    // target's parent (undefined when deleting a root message).
    const session = await repo.getSession(sessionId)
    if (
      typeof session?.currentLeafId === "number" &&
      toDeleteIds.has(session.currentLeafId)
    ) {
      await repo.updateSession(sessionId, { currentLeafId: targetParentId })
    }

    await repo.bulkDeleteMessages(idsToDelete)
    await repo.deleteFilesByMessageIds(idsToDelete)

    // Vector cleanup is best-effort and async — the chat surface
    // shouldn't block on it.
    for (const id of idsToDelete) {
      deleteVectors({ messageId: id }).catch((error) => {
        logger.error(
          "Failed to delete message embeddings",
          "chatSessionStore",
          { error, messageId: id }
        )
      })
    }

    set((state) => ({
      sessions: state.sessions.map((s) =>
        s.id === sessionId
          ? {
              ...s,
              messages: s.messages?.filter(
                (m) => !(typeof m.id === "number" && toDeleteIds.has(m.id))
              ),
              currentLeafId:
                typeof s.currentLeafId === "number" &&
                toDeleteIds.has(s.currentLeafId)
                  ? targetParentId
                  : s.currentLeafId
            }
          : s
      )
    }))

    // Reload to recompute sibling lists for the truncated tree.
    get().loadSessionMessages(sessionId)
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
      refreshSessions: s.refreshSessions,
      loadSessionMessages: s.loadSessionMessages,
      hasMoreMessages: s.hasMoreMessages,
      loadMoreMessages: s.loadMoreMessages,
      ensureMessageLoaded: s.ensureMessageLoaded,
      highlightedMessage: s.highlightedMessage,
      setHighlightedMessage: s.setHighlightedMessage,
      addMessage: s.addMessage,
      updateMessage: s.updateMessage,
      deleteMessage: s.deleteMessage,
      forkMessage: s.forkMessage,
      navigateToNode: s.navigateToNode
    }))
  )
  useEffect(() => {
    if (!store.sessions.length && !store.hasSession) {
      store.loadSessions()
    }
  }, [store.hasSession, store.loadSessions, store.sessions.length])
  return store
}
