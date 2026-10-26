import { bytesToBase64, isUnloadedImage } from "@/lib/image-utils"
import { getFileDataByRowIds } from "@/lib/repositories/chat-history"
import type { ChatMessage, ImageAttachment } from "@/types"

/**
 * Image bytes read back for display, newest use last.
 *
 * Bounded by bytes rather than count: a chat of twelve megabyte photos and a
 * chat of icons should cost the same memory. Entries are the stored bytes, not
 * base64, so a cached image costs its own size and no more.
 */
const CACHE_BYTE_LIMIT = 48 * 1024 * 1024
const cache = new Map<number, Uint8Array>()
let cachedBytes = 0

const remember = (rowId: number, bytes: Uint8Array) => {
  const existing = cache.get(rowId)
  if (existing) {
    cachedBytes -= existing.byteLength
    cache.delete(rowId)
  }
  cache.set(rowId, bytes)
  cachedBytes += bytes.byteLength
  for (const [oldest, value] of cache) {
    if (cachedBytes <= CACHE_BYTE_LIMIT || cache.size <= 1) break
    cache.delete(oldest)
    cachedBytes -= value.byteLength
  }
}

const inFlight = new Map<number, Promise<Uint8Array | undefined>>()

/**
 * How many image reads may be crossing the owner boundary at once.
 *
 * Each read is the image's bytes encoded for transport, decoded, and held until
 * collected, so a screenful asking together put about eighteen times their
 * size on the heap at the same moment. A few at a time keeps the peak flat and
 * the first pictures appearing while the rest wait their turn.
 */
const MAX_CONCURRENT_READS = 3
let activeReads = 0
const waiting: Array<() => void> = []

const withReadSlot = async <T>(read: () => Promise<T>): Promise<T> => {
  if (activeReads >= MAX_CONCURRENT_READS) {
    await new Promise<void>((resolve) => waiting.push(resolve))
  }
  activeReads += 1
  try {
    return await read()
  } finally {
    activeReads -= 1
    waiting.shift()?.()
  }
}

/** The bytes of one stored image row, read once while it is wanted. */
export const loadImageBytes = (
  rowId: number
): Promise<Uint8Array | undefined> => {
  const cached = cache.get(rowId)
  if (cached) {
    remember(rowId, cached)
    return Promise.resolve(cached)
  }
  const pending = inFlight.get(rowId)
  if (pending) return pending
  const request = withReadSlot(() => getFileDataByRowIds([rowId]))
    .then((rows) => {
      const bytes = rows.get(rowId)
      if (bytes) remember(rowId, bytes)
      return bytes
    })
    .finally(() => inFlight.delete(rowId))
  inFlight.set(rowId, request)
  return request
}

/** Forget cached bytes, for a test or when a session's rows are deleted. */
export const clearImageBytesCache = (): void => {
  cache.clear()
  cachedBytes = 0
}

/**
 * Give every image in these messages its bytes.
 *
 * A turn replays the conversation, so the history a request carries must hold
 * the pictures the model was shown, not references to rows. This runs where a
 * request is built, one read for all of them, so opening a chat never pays it.
 */
export const hydrateMessageImages = async (
  messages: ChatMessage[]
): Promise<ChatMessage[]> => {
  const missing = messages.flatMap((message) =>
    (message.images ?? []).filter(isUnloadedImage)
  )
  if (missing.length === 0) return messages
  const loaded = new Map<number, Uint8Array>()
  const toRead: number[] = []
  for (const image of missing) {
    const id = image.id as number
    const cached = cache.get(id)
    if (cached) loaded.set(id, cached)
    else toRead.push(id)
  }
  if (toRead.length > 0) {
    for (const [id, bytes] of await getFileDataByRowIds(toRead)) {
      loaded.set(id, bytes)
    }
  }
  const withBytes = (image: ImageAttachment): ImageAttachment => {
    if (!isUnloadedImage(image)) return image
    const bytes = loaded.get(image.id as number)
    if (!bytes) {
      throw new Error(`The stored bytes for image "${image.fileName}" are gone`)
    }
    return { ...image, base64: bytesToBase64(bytes) }
  }
  return messages.map((message) =>
    message.images?.some(isUnloadedImage)
      ? { ...message, images: message.images.map(withBytes) }
      : message
  )
}
