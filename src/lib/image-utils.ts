import type { FileAttachment, ImageAttachment } from "@/types"

const ALPHABET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"
const ENCODE = Uint8Array.from(ALPHABET, (char) => char.charCodeAt(0))
const DECODE = new Int16Array(128).fill(-1)
for (let i = 0; i < ALPHABET.length; i++) DECODE[ALPHABET.charCodeAt(i)] = i

/** The platform's own codec, where the engine ships one (Chrome 140+). */
interface NativeBase64 {
  fromBase64?: (text: string) => Uint8Array
}
const native = Uint8Array as unknown as NativeBase64
const nativeToBase64 = (
  Uint8Array.prototype as unknown as { toBase64?: () => string }
).toBase64

/**
 * Decode raw base64 (no `data:` prefix) into bytes.
 *
 * Without a binary-string intermediate: `atob` builds one character per byte
 * before the loop that copies it out, which made decoding a photo cost several
 * times its size in garbage. Whitespace is skipped, as `atob` skips it; any
 * other stray character throws.
 */
export const base64ToBytes = (base64: string): Uint8Array => {
  if (native.fromBase64) return native.fromBase64(base64)
  let length = base64.length
  while (length > 0 && base64.charCodeAt(length - 1) === 61) length--
  const out = new Uint8Array(Math.floor((length * 3) / 4))
  let position = 0
  let i = 0
  // Four characters to three bytes while the input is clean: no per-character
  // branching, which is what made the generic loop slower than `atob`.
  for (; i + 4 <= length; i += 4) {
    const a = DECODE[base64.charCodeAt(i) & 127]
    const b = DECODE[base64.charCodeAt(i + 1) & 127]
    const c = DECODE[base64.charCodeAt(i + 2) & 127]
    const d = DECODE[base64.charCodeAt(i + 3) & 127]
    if ((a | b | c | d) < 0 || base64.charCodeAt(i) > 127) break
    const chunk = (a << 18) | (b << 12) | (c << 6) | d
    out[position++] = chunk >> 16
    out[position++] = (chunk >> 8) & 255
    out[position++] = chunk & 255
  }
  // Anything left is the short tail, or input with whitespace or a stray
  // character that the fast path stopped at.
  let accumulator = 0
  let bits = 0
  for (; i < length; i++) {
    const code = base64.charCodeAt(i)
    const value = code < 128 ? DECODE[code] : -1
    if (value < 0) {
      if (code === 32 || (code >= 9 && code <= 13)) continue
      throw new Error("Invalid base64 input")
    }
    accumulator = (accumulator << 6) | value
    bits += 6
    if (bits >= 8) {
      bits -= 8
      out[position++] = (accumulator >> bits) & 0xff
    }
  }
  return position === out.length ? out : out.slice(0, position)
}

/**
 * Encode bytes to raw base64 (no `data:` prefix).
 *
 * Written straight into an ASCII buffer and decoded once, so the only large
 * allocations are the output buffer and the string it becomes.
 */
export const bytesToBase64 = (bytes: Uint8Array): string => {
  if (nativeToBase64) return nativeToBase64.call(bytes)
  const full = bytes.length - (bytes.length % 3)
  const out = new Uint8Array(Math.ceil(bytes.length / 3) * 4)
  let position = 0
  for (let i = 0; i < full; i += 3) {
    const chunk = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2]
    out[position++] = ENCODE[chunk >> 18]
    out[position++] = ENCODE[(chunk >> 12) & 63]
    out[position++] = ENCODE[(chunk >> 6) & 63]
    out[position++] = ENCODE[chunk & 63]
  }
  const rest = bytes.length - full
  if (rest === 1) {
    const chunk = bytes[full] << 16
    out[position++] = ENCODE[chunk >> 18]
    out[position++] = ENCODE[(chunk >> 12) & 63]
    out[position++] = 61
    out[position++] = 61
  } else if (rest === 2) {
    const chunk = (bytes[full] << 16) | (bytes[full + 1] << 8)
    out[position++] = ENCODE[chunk >> 18]
    out[position++] = ENCODE[(chunk >> 12) & 63]
    out[position++] = ENCODE[(chunk >> 6) & 63]
    out[position++] = 61
  }
  return new TextDecoder("latin1").decode(out)
}

/**
 * Whether an image is only a reference to a stored row.
 *
 * Opening a chat reads image metadata, not bytes, so a persisted image arrives
 * with an empty `base64` and the row id to fetch it by. A freshly attached or
 * generated image always carries its bytes.
 */
export const isUnloadedImage = (image: ImageAttachment): boolean =>
  image.base64 === "" && image.id !== undefined

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
