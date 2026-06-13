import { useCallback, useState } from "react"

import { SUPPORTED_IMAGE_MIME_TYPES } from "@/lib/constants"
import { stripDataUrlPrefix } from "@/lib/image-utils"
import type { ImageAttachment } from "@/types"

export type ImageRejectReason = "type" | "size"

interface UseImageAttachmentsOptions {
  maxSizeBytes: number
  onReject?: (reason: ImageRejectReason, file: File) => void
}

const isSupportedImage = (type: string): boolean =>
  (SUPPORTED_IMAGE_MIME_TYPES as readonly string[]).includes(type)

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

  const addFiles = useCallback(
    async (files: File[]) => {
      const accepted: ImageAttachment[] = []
      for (const file of files) {
        if (!isSupportedImage(file.type)) {
          onReject?.("type", file)
          continue
        }
        if (file.size > maxSizeBytes) {
          onReject?.("size", file)
          continue
        }
        const base64 = await readFileAsBase64(file)
        accepted.push({
          imageId: `img-${Date.now()}-${Math.random().toString(36).slice(2)}`,
          fileName: file.name,
          mimeType: file.type,
          size: file.size,
          base64
        })
      }
      if (accepted.length > 0) {
        setImages((prev) => [...prev, ...accepted])
      }
    },
    [maxSizeBytes, onReject]
  )

  const remove = useCallback((imageId: string) => {
    setImages((prev) => prev.filter((img) => img.imageId !== imageId))
  }, [])

  const clear = useCallback(() => setImages([]), [])

  return { images, addFiles, remove, clear }
}
