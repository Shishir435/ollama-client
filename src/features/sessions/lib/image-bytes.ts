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
  const request = getFileDataByRowIds([rowId])
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
