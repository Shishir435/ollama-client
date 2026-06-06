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
import type { ChatMessage, ChatSessionState } from "@/types"

import type { ChatSessionGet, ChatSessionSet } from "./chat-session-store-types"

let loadSessionMessagesRequestId = 0

export const createChatSessionMessageActions = (
  set: ChatSessionSet,
  get: ChatSessionGet
): Pick<
  ChatSessionState,
  | "loadSessionMessages"
  | "loadMoreMessages"
  | "ensureMessageLoaded"
  | "addMessage"
  | "updateMessage"
  | "forkMessage"
  | "navigateToNode"
  | "deleteMessage"
> => ({
  loadSessionMessages: async (sessionId: string) => {
    const requestId = ++loadSessionMessagesRequestId
    const isStaleLoad = () =>
      requestId !== loadSessionMessagesRequestId ||
      get().currentSessionId !== sessionId

    const session = await repo.getSession(sessionId)
    if (isStaleLoad()) return
    if (!session) return

    const allMessages =
      await repo.getMessagesBySessionOrderedByTimestamp(sessionId)
    if (isStaleLoad()) return

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
    if (isStaleLoad()) return
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

  addMessage: async (sessionId: string, message: ChatMessage) => {
    const session = get().sessions.find((s) => s.id === sessionId)
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

    const session = await repo.getSession(sessionId)
    if (
      typeof session?.currentLeafId === "number" &&
      toDeleteIds.has(session.currentLeafId)
    ) {
      await repo.updateSession(sessionId, { currentLeafId: targetParentId })
    }

    await repo.bulkDeleteMessages(idsToDelete)
    await repo.deleteFilesByMessageIds(idsToDelete)

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

    get().loadSessionMessages(sessionId)
  }
})
