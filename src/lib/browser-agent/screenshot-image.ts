import type { AgentImageEditor } from "./screenshot-capture"

/**
 * The image editor the capture pipeline masks and shrinks with, built on the
 * worker's `OffscreenCanvas`. Where that is missing — a test runtime, an
 * older browser — no editor is offered, and the pipeline then sends no
 * picture at all: masking is not optional, so an image that cannot be edited
 * cannot leave the device.
 */

const decodeBase64 = (data: string): Uint8Array => {
  const binary = atob(data)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }
  return bytes
}

const encodeBase64 = (bytes: Uint8Array): string => {
  let binary = ""
  const chunk = 0x8000
  for (let index = 0; index < bytes.length; index += chunk) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunk))
  }
  return btoa(binary)
}

const toBitmap = (image: { data: string; mimeType: string }) =>
  createImageBitmap(
    new Blob([decodeBase64(image.data) as BlobPart], { type: image.mimeType })
  )

export const createOffscreenAgentImageEditor = ():
  | AgentImageEditor
  | undefined => {
  if (
    typeof OffscreenCanvas === "undefined" ||
    typeof createImageBitmap === "undefined"
  ) {
    return undefined
  }
  return {
    async measure(image) {
      const bitmap = await toBitmap(image)
      try {
        return { width: bitmap.width, height: bitmap.height }
      } finally {
        bitmap.close()
      }
    },
    async transform(image, edit) {
      const bitmap = await toBitmap(image)
      try {
        const canvas = new OffscreenCanvas(edit.width, edit.height)
        const context = canvas.getContext("2d")
        if (!context) throw new Error("Agent screenshot canvas is unavailable")
        context.drawImage(bitmap, 0, 0, edit.width, edit.height)
        context.fillStyle = "#000000"
        for (const mask of edit.masks) {
          context.fillRect(mask.x, mask.y, mask.width, mask.height)
        }
        const blob = await canvas.convertToBlob({
          type: edit.mimeType,
          quality: edit.quality
        })
        return {
          data: encodeBase64(new Uint8Array(await blob.arrayBuffer())),
          width: edit.width,
          height: edit.height
        }
      } finally {
        bitmap.close()
      }
    }
  }
}
