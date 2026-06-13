import { isImageFile, storedFileToImage } from "@/lib/image-utils"
import type { ChatMessage, FileAttachment, ImageAttachment } from "@/types"

/**
 * In-memory traversal helpers over the chat-message tree.
 *
 * Sessions store messages as a tree rooted at the first message; each
 * message has an optional `parentId` and ordering is by timestamp. The
 * UI shows the *active path* from root to the session's `currentLeafId`
 * leaf. These pure helpers extract the path, identify siblings (for
 * fork navigation), and gather descendant ids (for cascading delete) —
 * without touching the database.
 */

/** Stable ordering for sibling lists. */
export const compareMessages = (a: ChatMessage, b: ChatMessage): number => {
  const tsA = a.timestamp ?? 0
  const tsB = b.timestamp ?? 0
  if (tsA !== tsB) return tsA - tsB
  return String(a.id ?? "").localeCompare(String(b.id ?? ""))
}

/**
 * Build a `parentId -> [child, ...]` map from a flat list of session
 * messages. Root-level messages live under the key `"root"`. Sibling
 * lists are sorted by `compareMessages`.
 */
export const buildSiblingsMap = (
  messages: ChatMessage[]
): Map<number | string, ChatMessage[]> => {
  const map = new Map<number | string, ChatMessage[]>()
  for (const msg of messages) {
    const key = msg.parentId ?? "root"
    const list = map.get(key) || []
    list.push(msg)
    map.set(key, list)
  }
  for (const list of map.values()) list.sort(compareMessages)
  return map
}

/** Build an id -> message lookup for messages that have an id. */
const buildMessageMap = (messages: ChatMessage[]) =>
  new Map(
    messages
      .filter((m) => m.id !== undefined)
      .map((m) => [String(m.id), m] as const)
  )

export interface PathResult {
  /** Active path from earliest ancestor we visited to the leaf. */
  path: ChatMessage[]
  /** True if the traversal stopped before hitting a root message. */
  hasMore: boolean
}

/**
 * Walk UP from `leafId` toward the root, up to `limit` messages,
 * collecting the active conversation path. Returns the path in
 * root-to-leaf order plus a `hasMore` flag if there are earlier
 * messages we did not include.
 */
export const traversePathFromLeaf = (
  messages: ChatMessage[],
  leafId: number | string,
  limit: number
): PathResult => {
  const msgMap = buildMessageMap(messages)
  const path: ChatMessage[] = []
  let currentId: number | string | undefined = leafId
  let iterations = 0

  while (currentId !== undefined && iterations < limit) {
    const msg = msgMap.get(String(currentId))
    if (!msg) break
    path.unshift(msg)
    currentId = msg.parentId
    iterations++
  }

  return { path, hasMore: currentId !== undefined }
}

/**
 * Like `traversePathFromLeaf`, but walks one step at a time using a
 * provided fetcher. Used by paginated history loading where each step
 * is a separate DB round-trip.
 */
export const traversePathFromLeafWithFetcher = async (
  startId: number | string,
  limit: number,
  fetcher: (id: number | string) => Promise<ChatMessage | undefined>
): Promise<PathResult> => {
  const path: ChatMessage[] = []
  let currentId: number | string | undefined = startId
  let iterations = 0

  while (currentId !== undefined && iterations < limit) {
    const msg = await fetcher(currentId)
    if (!msg) break
    path.unshift(msg)
    currentId = msg.parentId
    iterations++
  }

  return { path, hasMore: currentId !== undefined }
}

/**
 * BFS from `rootId` over the parent->children map. Used by
 * cascading delete to find every descendant id below a target message.
 */
export const collectDescendantIds = (
  messages: ChatMessage[],
  rootId: number
): Set<number> => {
  const childrenMap = new Map<number, number[]>()
  for (const msg of messages) {
    if (typeof msg.parentId === "number" && typeof msg.id === "number") {
      const list = childrenMap.get(msg.parentId) || []
      list.push(msg.id)
      childrenMap.set(msg.parentId, list)
    }
  }

  const ids = new Set<number>([rootId])
  const queue = [rootId]
  while (queue.length > 0) {
    const current = queue.shift()
    if (current === undefined) continue
    for (const childId of childrenMap.get(current) || []) {
      if (!ids.has(childId)) {
        ids.add(childId)
        queue.push(childId)
      }
    }
  }
  return ids
}

/**
 * Decorate each message in `path` with its attachments and its
 * sibling-id list (only populated when the message has more than one
 * sibling, since single-sibling lists carry no fork-navigation value).
 */
export const enrichPathWithSiblingsAndAttachments = (
  path: ChatMessage[],
  siblingsMap: Map<number | string, ChatMessage[]>,
  filesByMessageId: Map<number, FileAttachment[]>
): ChatMessage[] =>
  path.map((msg) => {
    const siblings = siblingsMap.get(msg.parentId ?? "root") || [msg]
    const siblingIds = siblings
      .map((s) => s.id)
      .filter((id): id is number | string => id !== undefined)
    const files =
      typeof msg.id === "number" ? filesByMessageId.get(msg.id) || [] : []
    const { attachments, images } = splitStoredFiles(files)
    return {
      ...msg,
      attachments,
      images: images.length > 0 ? images : undefined,
      siblingIds: siblingIds.length > 1 ? siblingIds : undefined
    }
  })

/**
 * Split stored `files` rows back into RAG attachments and image attachments.
 * Images are identified by an `image/*` mime type and reconstructed with their
 * base64 payload so they can be previewed and re-sent.
 */
export const splitStoredFiles = (
  files: FileAttachment[]
): { attachments: FileAttachment[]; images: ImageAttachment[] } => {
  const attachments: FileAttachment[] = []
  const images: ImageAttachment[] = []
  for (const file of files) {
    if (isImageFile(file)) {
      images.push(storedFileToImage(file))
    } else {
      attachments.push(file)
    }
  }
  return { attachments, images }
}

/**
 * Find the latest leaf descending from `nodeId`, picking the
 * timestamp-latest child at each step.
 */
export const findLatestLeafDescendant = (
  messages: ChatMessage[],
  nodeId: number | string
): number | string => {
  const childrenByParent = new Map<string, ChatMessage[]>()
  for (const msg of messages) {
    if (msg.id === undefined || msg.parentId === undefined) continue
    const key = String(msg.parentId)
    const list = childrenByParent.get(key) || []
    list.push(msg)
    childrenByParent.set(key, list)
  }
  for (const list of childrenByParent.values()) list.sort(compareMessages)

  let currentId = nodeId
  const limit = Math.max(messages.length, 1)
  let iterations = 0
  while (iterations < limit) {
    const children = childrenByParent.get(String(currentId)) || []
    if (children.length === 0) break
    const nextId = children[children.length - 1]?.id
    if (nextId === undefined || String(nextId) === String(currentId)) break
    currentId = nextId
    iterations++
  }
  return currentId
}

/**
 * Group a list of files by their `messageId`. Files without a numeric
 * messageId are skipped.
 */
export const groupFilesByMessageId = (
  files: FileAttachment[]
): Map<number, FileAttachment[]> => {
  const map = new Map<number, FileAttachment[]>()
  for (const file of files) {
    if (typeof file.messageId === "number") {
      const list = map.get(file.messageId) || []
      list.push(file)
      map.set(file.messageId, list)
    }
  }
  return map
}
