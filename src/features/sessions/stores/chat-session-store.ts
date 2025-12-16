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
    const all = await db.sessions.orderBy("updatedAt").reverse().toArray()
    set({
      sessions: all,
      currentSessionId: all.length > 0 ? all[0].id : null,
      hasSession: all.length > 0,
      hydrated: true
    })

    if (all.length > 0) {
      await get().loadSessionMessages(all[0].id)
    }
  },

  loadSessionMessages: async (sessionId: string) => {
    const session = await db.sessions.get(sessionId)
    if (!session) return

    // 1. Get the Leaf ID (Tip of the active branch)
    // If undefined, find the latest message by timestamp
    let leafId = session.currentLeafId

    // Load ALL messages for the session to build the tree context robustly
    // This avoids complex index queries and ensures we catch all siblings/roots
    const allMessages = await db.messages
      .where("sessionId")
      .equals(sessionId)
      .sortBy("timestamp")

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

    if (!leafId) {
      // Fallback: Use the last message in linear time
      leafId = allMessages[allMessages.length - 1].id
    }

    // 2. Build Tree Maps (Parent -> Children) needed for finding siblings
    const siblingsMap = new Map<number | string, ChatMessage[]>()

    for (const msg of allMessages) {
      const key = msg.parentId ?? "root"
      const list = siblingsMap.get(key) || []
      list.push(msg)
      siblingsMap.set(key, list)
    }

    // Ensure siblings are sorted (by ID or timestamp)
    for (const list of siblingsMap.values()) {
      list.sort((a, b) => (a.id || 0) - (b.id || 0))
    }

    // 3. Traverse UP from Leaf to Root to build Active Path
    const path: ChatMessage[] = []
    let currentId = leafId
    // Use a Map for O(1) lookup during traversal
    const msgMap = new Map(allMessages.map((m) => [m.id, m]))

    const LIMIT = CHAT_PAGINATION_LIMIT
    let iterations = 0

    while (currentId !== undefined && iterations < LIMIT) {
      const msg = msgMap.get(currentId)
      if (!msg) break
      path.unshift(msg)
      currentId = msg.parentId
      iterations++
    }

    const hasMore = currentId !== undefined // If we stopped before root

    // 4. Load Attachments
    const messageIds = path.map((m) => m.id as number)
    const files = await db.files.where("messageId").anyOf(messageIds).toArray()
    const filesByMessageId = new Map<number, FileAttachment[]>()
    for (const file of files) {
      if (file.messageId) {
        const list = filesByMessageId.get(file.messageId) || []
        list.push(file)
        filesByMessageId.set(file.messageId, list)
      }
    }

    // 5. Enrich Messages with Attachments and Sibling Data
    const messagesWithData = path.map((msg) => {
      const siblings = siblingsMap.get(msg.parentId ?? "root") || [msg]
      const siblingIds = siblings.map((s) => s.id as number)

      return {
        ...msg,
        attachments: (msg.id && filesByMessageId.get(msg.id)) || [],
        siblingIds: siblingIds.length > 1 ? siblingIds : undefined
      }
    })

    set((state) => ({
      hasMoreMessages: hasMore,
      sessions: state.sessions.map((s) =>
        s.id === sessionId
          ? { ...s, messages: messagesWithData, currentLeafId: leafId }
          : s
      )
    }))
  },

  // NOTE: Pagination (loadMoreMessages) now needs to continue traversing UP from the first message in the list.
  loadMoreMessages: async () => {
    const { currentSessionId, sessions } = get()
    if (!currentSessionId) return

    const currentSession = sessions.find((s) => s.id === currentSessionId)
    if (!currentSession?.messages?.length) return

    const oldestMsg = currentSession.messages[0]
    let currentId = oldestMsg.parentId

    if (currentId === undefined) {
      set({ hasMoreMessages: false })
      return
    }

    const path: ChatMessage[] = []
    let iterations = 0
    const LIMIT = CHAT_PAGINATION_LIMIT

    while (currentId !== undefined && iterations < LIMIT) {
      const msg = await db.messages.get(currentId)
      if (!msg) break
      path.unshift(msg)
      currentId = msg.parentId
      iterations++
    }

    const hasMore = currentId !== undefined

    const messageIds = path.map((m) => m.id as number)
    const files = await db.files.where("messageId").anyOf(messageIds).toArray()
    const filesByMessageId = new Map<number, FileAttachment[]>()
    // ... (same file logic)
    for (const file of files) {
      if (file.messageId) {
        const existing = filesByMessageId.get(file.messageId) || []
        existing.push(file)
        filesByMessageId.set(file.messageId, existing)
      }
    }

    // 3b. Siblings (Context for Forks)
    const parentIds = path
      .map((m) => m.parentId)
      .filter((id) => id !== undefined) as number[]
    let siblingCandidates: ChatMessage[] = []
    if (parentIds.length > 0) {
      siblingCandidates = await db.messages
        .where("parentId")
        .anyOf(parentIds)
        .toArray()
    }
    const hasRoots = path.some((m) => !m.parentId)
    if (hasRoots) {
      const rootSiblings = await db.messages
        .where("sessionId")
        .equals(currentSessionId)
        .filter((m) => !m.parentId)
        .toArray()
      siblingCandidates = [...siblingCandidates, ...rootSiblings]
    }
    const siblingsByParent = new Map<number | string, ChatMessage[]>()
    for (const msg of siblingCandidates) {
      const key = msg.parentId ?? "root"
      const list = siblingsByParent.get(key) || []
      list.push(msg)
      siblingsByParent.set(key, list)
    }
    for (const list of siblingsByParent.values()) {
      list.sort((a, b) => (a.id || 0) - (b.id || 0))
    }

    const messagesWithData = path.map((msg) => {
      const siblings = siblingsByParent.get(msg.parentId ?? "root") || [msg]
      const siblingIds = siblings.map((s) => s.id as number)
      return {
        ...msg,
        attachments: msg.id ? filesByMessageId.get(msg.id) || [] : [],
        siblingIds: siblingIds.length > 1 ? siblingIds : undefined
      }
    })

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
    messageId?: number
  ) => {
    // If messageId is provided, we can strictly navigate to the branch containing it.
    if (messageId) {
      // Re-use navigateToNode logic which finds the best leaf for a node
      await get().navigateToNode(sessionId, messageId)
      return
    }

    // Legacy support: timestamp based (less precise for forks)
    // Usually, if we are searching, we likely have messageId now.
    // But if not, we fallback to just loading session (which loads active branch).
    // This might miss the message if it's on another branch.
    // Ideally we find the message ID by timestamp?
    if (!messageId) {
      try {
        // Try to find the message by timestamp in this session to get its ID
        const msgs = await db.messages
          .where("sessionId")
          .equals(sessionId)
          .filter((m) => m.timestamp === timestamp)
          .toArray()
        if (msgs.length > 0) {
          // Pick the first one? Or prompt user?
          // Default to first match
          if (msgs[0]?.id) {
            await get().navigateToNode(sessionId, msgs[0].id)
          }
          return
        }
      } catch (_e) {
        // ignore
        logger.error(
          "Failed to find message by timestamp",
          "chatSessionStore",
          { error: _e }
        )
      }
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
    await db.sessions.add(newSession)
    set((state) => ({
      sessions: [newSession, ...state.sessions],
      currentSessionId: id,
      hasSession: true
    }))
  },

  deleteSession: async (id: string) => {
    await db.sessions.delete(id)
    await db.messages.where("sessionId").equals(id).delete()
    await db.files.where("sessionId").equals(id).delete()
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

  // Simplified updateMessages (legacy bulk update - mostly unused now?)
  // We'll leave it but caution its use with tree.
  updateMessages: async (_id: string, _messages: ChatSession["messages"]) => {
    // ... (Legacy logic preserved or skipped instructions)
    // This is usually for "restore" or complex ops.
    // Leaving mostly as is but ensuring we don't break tree if possible.
    // Actually, if we bulk put, we lose parentIds if not in input.
    // Assuming this is unused in main flow.
  },

  addMessage: async (sessionId: string, message: ChatMessage) => {
    // 1. Determine Parent
    const session = get().sessions.find((s) => s.id === sessionId)
    let parentId = session?.currentLeafId
    if (!parentId && session?.messages?.length && session.messages.length > 0) {
      // Fallback: previous message in list
      parentId = session.messages[session.messages.length - 1].id
    }

    // 2. Add to DB
    const timestamp = message.timestamp || Date.now()
    const msgWithSession = {
      ...message,
      sessionId,
      timestamp,
      parentId
    }

    // If user explicitly passed parentId (e.g. reply to specific), respect it?
    // message.parentId override would be here if allowed.
    if (message.parentId !== undefined) {
      msgWithSession.parentId = message.parentId
    }

    const id = (await db.messages.add(msgWithSession)) as number

    // 3. Add attachments
    if (message.attachments && message.attachments.length > 0) {
      const files = message.attachments.map((f) => ({
        ...f,
        messageId: id,
        sessionId
      }))
      await db.files.bulkAdd(files)
    }

    // 4. Update session
    const updatedAt = Date.now()
    await db.sessions.update(sessionId, { updatedAt, currentLeafId: id })

    // 5. Reload session to reflect the new path and populate siblingIds
    // We cannot just optimistically update local state because we need to recalculate
    // siblingIds for the previous leaf and the new message, which requires tree traversal.
    await get().loadSessionMessages(sessionId)

    return id
  },

  // This handles IN-PLACE updates (metrics, streaming content)
  updateMessage: async (
    messageId: number,
    updates: Partial<ChatMessage>,
    skipDb = false
  ) => {
    if (!skipDb) {
      await db.messages.update(messageId, updates)
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

  // NEW: Fork (Edit) Message
  forkMessage: async (
    sessionId: string,
    originalMessageId: number,
    newContent: string
  ) => {
    // 1. Get original message to find its parent
    const originalMsg = await db.messages.get(originalMessageId)
    if (!originalMsg) return

    // 2. Create new message as sibling
    const newMessage: ChatMessage = {
      role: originalMsg.role,
      content: newContent,
      parentId: originalMsg.parentId, // Same parent = Sibling
      model: originalMsg.model
    }

    // 3. Add using standard addMessage flow?
    // addMessage usually appends to *currentLeafId*.
    // Here we are inserting in the middle of history.
    // So we cannot use addMessage's default logic of "parent = currentLeaf".

    const timestamp = Date.now()
    const msgToSave = {
      ...newMessage,
      sessionId,
      timestamp
    }

    const newId = (await db.messages.add(msgToSave)) as number

    // 4. Set this new message as the new "Leaf" of the session?
    // YES. Editing a message essentially jumps to that point and makes it the active head.
    // Any response generated will attach to THIS message.
    await db.sessions.update(sessionId, {
      currentLeafId: newId,
      updatedAt: timestamp
    })

    // 5. Reload session to reflect the new path (which is just ...parent, newMsg)
    await get().loadSessionMessages(sessionId)

    return newId
  },

  // Navigate to a specific message (make it the active leaf or part of active path?)
  // If I click "<" on a node, I want to swap that node.
  // Swapping a node implies switching the Active Path to one that passes through sibling.
  // If sibling is a leaf, set leaf to sibling.
  // If sibling has children, "Active Path" usually remembers the last active leaf for that branch?
  // For MVP: Navigate to sibling -> Sibling becomes leaf (truncating its children if any? or we find its latest child?)
  // Let's implement simpler: Switch to sibling -> Sibling is the new view focus.
  // BUT we need to set `currentLeafId`.
  // If I switch to a node that has children, which child do I pick?
  // Strategy: "Latest Child".
  navigateToNode: async (sessionId: string, nodeId: number, exact = false) => {
    // Logic: Navigate to the LATEST leaf that descends from this node.
    // If exact is true, we strictly set the currentLeafId to this node (cutting off any existing children from view, essentially preparing to fork or view just this point).

    let currentId = nodeId

    if (!exact) {
      let iterations = 0
      const LIMIT = 100 // Prevent infinite loops

      while (iterations < LIMIT) {
        // Find children of currentId
        // We need to query DB. "parentId" index.
        const children = await db.messages
          .where("parentId")
          .equals(currentId)
          .sortBy("timestamp")

        if (children.length === 0) {
          // It is a leaf.
          break
        }

        // Pick the last child (most recent)
        currentId = children[children.length - 1].id
        iterations++
      }
    }

    await db.sessions.update(sessionId, { currentLeafId: currentId })
    await get().loadSessionMessages(sessionId)
  },

  deleteMessage: async (messageId: number) => {
    await db.messages.delete(messageId)
    await db.files.where("messageId").equals(messageId).delete()
    deleteVectors({ messageId }).catch((error) => {
      logger.error("Failed to delete message embeddings", "chatSessionStore", {
        error,
        messageId
      })
    })

    // If deleted message was current leaf, we need to pick a new leaf.
    // Parent?
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
