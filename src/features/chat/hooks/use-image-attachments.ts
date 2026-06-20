import { useCallback, useState } from "react"

import {
  HEIC_EXTENSION_PATTERN,
  HEIC_MIME_TYPES,
  SUPPORTED_IMAGE_MIME_TYPES
} from "@/lib/constants"
import { stripDataUrlPrefix } from "@/lib/image-utils"
import type { ImageAttachment } from "@/types"

export type ImageRejectReason = "type" | "size" | "heic"

interface UseImageAttachmentsOptions {
  maxSizeBytes: number
  onReject?: (reason: ImageRejectReason, file: File) => void
}

const isSupportedImage = (type: string): boolean =>
  (SUPPORTED_IMAGE_MIME_TYPES as readonly string[]).includes(type)

const isHeic = (file: File): boolean =>
  (HEIC_MIME_TYPES as readonly string[]).includes(file.type) ||
  HEIC_EXTENSION_PATTERN.test(file.name)

const readFileAsBase64 = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(stripDataUrlPrefix(String(reader.result)))
    reader.onerror = () => reject(reader.error ?? new Error("Failed to read"))
    reader.readAsDataURL(file)
  })

/**
 * Holds the images staged in the composer. Validates type + size against a
 * configurable cap and reads accepted files into base64 `ImageAttachment`s.
 */
export const useImageAttachments = ({
  maxSizeBytes,
  onReject
}: UseImageAttachmentsOptions) => {
  const [images, setImages] = useState<ImageAttachment[]>([])

  // Validate + read one file into an ImageAttachment, or null. Does NOT stage it
  // — callers that want it staged use addFiles. `notify` controls the onReject
  // toast: pass false for silent paths (e.g. auto screenshot on send).
  const fileToAttachment = useCallback(
    async (file: File, notify = true): Promise<ImageAttachment | null> => {
      const reject = (reason: ImageRejectReason) => {
        if (notify) onReject?.(reason, file)
      }
      if (isHeic(file)) {
        reject("heic")
        return null
      }
      if (!isSupportedImage(file.type)) {
        reject("type")
        return null
      }
      if (file.size > maxSizeBytes) {
        reject("size")
        return null
      }
      let base64: string
      try {
        base64 = await readFileAsBase64(file)
      } catch {
        reject("type")
        return null
      }
      return {
        imageId: `img-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        fileName: file.name,
        mimeType: file.type,
        size: file.size,
        base64
      }
    },
    [maxSizeBytes, onReject]
  )

  const addFiles = useCallback(
    async (files: File[]) => {
      const accepted: ImageAttachment[] = []
      for (const file of files) {
        const attachment = await fileToAttachment(file)
        if (attachment) accepted.push(attachment)
      }
      if (accepted.length > 0) {
        setImages((prev) => [...prev, ...accepted])
      }
    },
    [fileToAttachment]
  )

  const remove = useCallback((imageId: string) => {
    setImages((prev) => prev.filter((img) => img.imageId !== imageId))
  }, [])

  const clear = useCallback(() => setImages([]), [])

  return { images, addFiles, fileToAttachment, remove, clear }
}
