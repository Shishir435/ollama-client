import { useEffect, useState } from "react"
import { loadImageBytes } from "@/features/sessions/lib/image-bytes"
import { isUnloadedImage, toDataUrl } from "@/lib/image-utils"
import type { ImageAttachment } from "@/types"

/**
 * A URL an `<img>` can show for this image, or `undefined` while it loads.
 *
 * An image that carries its bytes becomes a data URL at once. One that is only
 * a stored-row reference is read when it mounts — the message list is
 * virtualized, so that is when its message scrolls into view — and shown
 * through an object URL, which the browser decodes without a base64 string
 * that size ever existing in the page.
 */
export const useImageSource = (image: ImageAttachment): string | undefined => {
  const unloaded = isUnloadedImage(image)
  const [objectUrl, setObjectUrl] = useState<string>()
  const rowId = image.id
  const { mimeType } = image

  useEffect(() => {
    if (!unloaded || rowId === undefined) return
    let cancelled = false
    let created: string | undefined
    void loadImageBytes(rowId).then((bytes) => {
      if (cancelled || !bytes) return
      created = URL.createObjectURL(
        new Blob([bytes as BlobPart], { type: mimeType })
      )
      setObjectUrl(created)
    })
    return () => {
      cancelled = true
      if (created) URL.revokeObjectURL(created)
      setObjectUrl(undefined)
    }
  }, [unloaded, rowId, mimeType])

  return unloaded ? objectUrl : toDataUrl(image.mimeType, image.base64)
}
