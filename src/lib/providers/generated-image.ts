import { base64ToBytes, stripDataUrlPrefix } from "@/lib/image-utils"
import type { ImageAttachment } from "@/types"

/** Bound provider output before it enters stream snapshots or durable storage. */
export const MAX_GENERATED_IMAGE_BYTES = 20 * 1024 * 1024

const sniffImageMimeType = (bytes: Uint8Array): string | null => {
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  ) {
    return "image/png"
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    return "image/jpeg"
  }
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return "image/webp"
  }
  return null
}

/** Normalize and validate provider-owned base64 into the shared image shape. */
export const generatedImageFromBase64 = (
  value: string,
  provenance: { providerId: string; model: string },
  index = 0
): ImageAttachment | null => {
  const base64 = stripDataUrlPrefix(value.trim())
  if (!base64 || base64.length > MAX_GENERATED_IMAGE_BYTES * 1.4) return null

  let bytes: Uint8Array
  try {
    bytes = base64ToBytes(base64)
  } catch {
    return null
  }
  if (bytes.length === 0 || bytes.length > MAX_GENERATED_IMAGE_BYTES)
    return null
  const mimeType = sniffImageMimeType(bytes)
  if (!mimeType) return null
  const extension = mimeType === "image/jpeg" ? "jpg" : mimeType.slice(6)

  return {
    imageId: `generated-${crypto.randomUUID()}`,
    fileName: `generated-image-${index + 1}.${extension}`,
    mimeType,
    size: bytes.length,
    base64,
    origin: "model-generated",
    generatedBy: provenance
  }
}
