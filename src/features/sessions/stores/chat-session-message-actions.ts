import {
  buildSiblingsMap,
  enrichPathWithSiblingsAndAttachments,
  findLatestLeafDescendant,
  findNewestStructuralLeaf,
  groupFilesByMessageId,
  traversePathFromLeaf,
  traversePathFromLeafWithFetcher
} from "@/features/sessions/lib/message-tree"
import { CHAT_PAGINATION_LIMIT } from "@/lib/constants"
import { sweepVectorCleanupReceipts } from "@/lib/embeddings/vector-cleanup-receipts"
import { deleteVectors } from "@/lib/embeddings/vector-store"
import { imageToStoredFile } from "@/lib/image-utils"
import { logger } from "@/lib/logger"
import * as repo from "@/lib/repositories/chat-history"
import type { ChatMessage, ChatSessionState } from "@/types"

import type { ChatSessionGet, ChatSessionSet } from "./chat-session-store-types"

let loadSessionMessagesRequestId = 0
let loadMoreMessagesRequestId = 0

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

    /**
     * A tree that did not fully decode is not published at all.
     *
     * Leaving the session's existing state alone keeps the store's
     * `currentLeafId` as it was, which matters more than the render: `addMessage`
     * takes that value as the new message's `parentId` and persists it, so a
     * leaf guessed from an incomplete tree would durably re-parent the next
     * thing the user sends.
     */
    let treeNodes: repo.MessageTreeRow[]
    try {
      treeNodes = await repo.getMessageTreeBySession(sessionId)
    } catch (error) {
      logger.error(
        "Failed to read the message tree; leaving the session unchanged",
        "chatSessionStore",
        { error, sessionId }
      )
      return
    }
    if (isStaleLoad()) return

    if (treeNodes.length === 0) {
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

    const storedLeafId =
      session.currentLeafId ?? findNewestStructuralLeaf(treeNodes)
    if (storedLeafId === undefined) return

    /**
     * The walk starts from a node the tree actually contains.
     *
     * `traversePathFromLeaf` stops the moment an id is missing, so a leaf that
     * is not in the tree produces an empty path — an empty conversation, with a
     * load-more affordance, while every row is still sitting in SQLite.
     *
     * Reaching here means the tree decoded completely, so this is a stale
     * pointer rather than missing data: something removed messages without
     * repairing `sessions.currentLeafId`. The fallback is a structural leaf —
     * a node no other node claims as its parent — rather than the newest row,
     * because the two only coincide while timestamps rise with depth, and an
     * imported or clock-skewed session breaks that. It is safe to hand
     * `addMessage` as the next parent. The decode-failure case cannot arrive
     * here at all — it returned above rather than guess.
     *
     * Still not written back: a read does not repair durable state.
     */
    const leafId = treeNodes.some(
      (node) => String(node.id) === String(storedLeafId)
    )
      ? storedLeafId
      : findNewestStructuralLeaf(treeNodes)
    if (leafId === undefined) return
    if (leafId !== storedLeafId) {
      logger.warn(
        "Stored leaf is not in the message tree; falling back to the newest leaf",
        "chatSessionStore",
        { sessionId, treeSize: treeNodes.length }
      )
    }

    const siblingsMap = buildSiblingsMap(treeNodes)
    const { path: pathNodes, hasMore } = traversePathFromLeaf(
      treeNodes,
      leafId,
      CHAT_PAGINATION_LIMIT
    )

    const messageIds = pathNodes
      .map((m) => m.id)
      .filter((id): id is number => typeof id === "number")

    // Whole rows are read only for the <=CHAT_PAGINATION_LIMIT ids on the
    // resolved path; the rest of the tree never leaves the worker.
    const [pathMessages, files] = await Promise.all([
      messageIds.length > 0 ? repo.getMessagesByIds(messageIds) : [],
      messageIds.length > 0 ? repo.getFilesByMessageIds(messageIds) : []
    ])
    if (isStaleLoad()) return

    const messagesById = new Map(
      pathMessages.map((message) => [String(message.id), message] as const)
    )
    const path = messageIds
      .map((id) => messagesById.get(String(id)))
      .filter((message) => message !== undefined)
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
    const requestId = ++loadMoreMessagesRequestId
    const isStaleLoad = () =>
      requestId !== loadMoreMessagesRequestId ||
      get().currentSessionId !== currentSessionId

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
    if (isStaleLoad()) return

    const messageIds = path
      .map((m) => m.id)
      .filter((id): id is number => typeof id === "number")
    const files =
      messageIds.length > 0 ? await repo.getFilesByMessageIds(messageIds) : []
    if (isStaleLoad()) return
    const filesByMessageId = groupFilesByMessageId(files)

    const parentIds = path
      .map((m) => m.parentId)
      .filter((id): id is number | string => id !== undefined)
    let siblingCandidates: ChatMessage[] = []
    if (parentIds.length > 0) {
      siblingCandidates = await repo.getMessagesByParents(parentIds)
      if (isStaleLoad()) return
    }
    if (path.some((m) => !m.parentId)) {
      const rootSiblings =
        await repo.getRootMessagesForSession(currentSessionId)
      if (isStaleLoad()) return
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
    const fileRows = [
      ...(message.attachments?.map((f) => ({
        ...f,
        sessionId
      })) ?? []),
      ...(message.images?.map((img) => imageToStoredFile(img, 0, sessionId)) ??
        [])
    ]
    const id = await repo.appendMessage(
      {
        ...messageWithoutId,
        sessionId,
        timestamp,
        parentId
      },
      fileRows,
      session
    )

    const savedMessage: ChatMessage = {
      ...message,
      id,
      timestamp,
      parentId
    }
    set((state) => ({
      sessions: state.sessions.map((candidate) =>
        candidate.id === sessionId
          ? {
              ...candidate,
              updatedAt: Date.now(),
              currentLeafId: id,
              messages: [...(candidate.messages ?? []), savedMessage]
            }
          : candidate
      )
    }))

    try {
      await get().loadSessionMessages(sessionId)
    } catch (error) {
      // The atomic append already succeeded and the optimistic state above is
      // usable. A read-back failure must not tell the user their send failed.
      logger.error(
        "Failed to refresh messages after append",
        "chatSessionStore",
        {
          error,
          sessionId,
          messageId: id
        }
      )
    }
    return id
  },

  updateMessage: async (
    messageId: number,
    updates: Partial<ChatMessage>,
    skipDb = false
  ) => {
    if (!skipDb) {
      if (updates.images !== undefined) {
        await repo.updateMessageWithImages(messageId, updates, updates.images)
      } else {
        await repo.updateMessage(messageId, updates)
      }
      if (updates.content) {
        try {
          await deleteVectors({ messageId })
        } catch (error) {
          logger.error(
            "Failed to delete outdated embeddings",
            "chatSessionStore",
            { error, messageId }
          )
        }
      }
    }

    set((state) => ({
      sessions: state.sessions.map((session) => {
        const messages = session.messages
        if (!messages?.some((message) => message.id === messageId)) {
          return session
        }

        return {
          ...session,
          messages: messages.map((message) =>
            message.id === messageId ? { ...message, ...updates } : message
          )
        }
      })
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
    const session = get().sessions.find(
      (candidate) => candidate.id === sessionId
    )
    const newId = await repo.appendMessage(
      {
        role: originalMsg.role,
        content: newContent,
        sessionId,
        timestamp,
        parentId: originalMsg.parentId,
        model: originalMsg.model
      },
      [],
      session
    )
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
      // This branch resolves a leaf and then *persists* it, so an incomplete
      // tree would durably move the user's conversation to whatever descendant
      // survived. Abort the navigation instead.
      try {
        const treeNodes = await repo.getMessageTreeBySession(sessionId)
        leafId = findLatestLeafDescendant(treeNodes, nodeId)
      } catch (error) {
        logger.error(
          "Failed to read the message tree; leaving the branch unchanged",
          "chatSessionStore",
          { error, sessionId }
        )
        return
      }
    }

    await repo.updateSession(sessionId, { currentLeafId: leafId })
    await get().loadSessionMessages(sessionId)
  },

  deleteMessage: async (messageId: number) => {
    const deleted = await repo.deleteMessageSubtree(messageId)
    if (!deleted) return

    const {
      sessionId,
      messageIds: idsToDelete,
      repairedLeaf,
      replacementLeafId
    } = deleted
    const toDeleteIds = new Set(idsToDelete)

    try {
      await sweepVectorCleanupReceipts()
    } catch (error) {
      // SQLite deletion and its cleanup receipt are already committed. Keep
      // the UI consistent with that durable result; startup will retry the
      // idempotent vector cleanup from the retained receipt.
      logger.error("Failed to sweep message embeddings", "chatSessionStore", {
        error
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
              currentLeafId: repairedLeaf ? replacementLeafId : s.currentLeafId
            }
          : s
      )
    }))

    try {
      await get().loadSessionMessages(sessionId)
    } catch (error) {
      // The delete and local state update already succeeded. Keep that state
      // usable and report only the failed read-back.
      logger.error(
        "Failed to refresh messages after delete",
        "chatSessionStore",
        { error, sessionId, messageId }
      )
    }
  }
})
