import type { FileAttachment, ImageAttachment } from "@/types"

/** Decode raw base64 (no `data:` prefix) into bytes. */
export const base64ToBytes = (base64: string): Uint8Array => {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes
}

/** Encode bytes to raw base64 (no `data:` prefix). */
export const bytesToBase64 = (bytes: Uint8Array): string => {
  let binary = ""
  // Chunk to stay well under the argument-count limit of String.fromCharCode.
  const chunkSize = 0x8000
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize))
  }
  return btoa(binary)
}

/** Build a `data:<mime>;base64,<b64>` URL from a mime type + raw base64. */
export const toDataUrl = (mimeType: string, base64: string): string =>
  `data:${mimeType};base64,${base64}`

/** Strip a `data:...;base64,` prefix if present, returning raw base64. */
export const stripDataUrlPrefix = (value: string): string => {
  const comma = value.indexOf(",")
  return value.startsWith("data:") && comma !== -1
    ? value.slice(comma + 1)
    : value
}

/**
 * Persist an image as a row in the shared `files` table. Images reuse that
 * table (no schema migration): `fileType` carries the mime type and `data`
 * holds the decoded bytes.
 */
export const imageToStoredFile = (
  image: ImageAttachment,
  messageId: number,
  sessionId: string
): FileAttachment & { sessionId: string; messageId: number } => ({
  fileId: image.imageId,
  fileName: image.fileName,
  fileType: image.mimeType,
  fileSize: image.size,
  processedAt: Date.now(),
  data: base64ToBytes(image.base64),
  messageId,
  sessionId
})

/** Reconstruct an {@link ImageAttachment} from a stored `files` row. */
export const storedFileToImage = (file: FileAttachment): ImageAttachment => ({
  id: file.id,
  imageId: file.fileId,
  fileName: file.fileName,
  mimeType: file.fileType,
  size: file.fileSize,
  base64: file.data ? bytesToBase64(file.data) : "",
  sessionId: file.sessionId,
  messageId: file.messageId
})

export const isImageFile = (file: FileAttachment): boolean =>
  typeof file.fileType === "string" && file.fileType.startsWith("image/")
