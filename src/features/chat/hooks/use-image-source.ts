import { type RefObject, useEffect, useRef, useState } from "react"
import { loadImageBytes } from "@/features/sessions/lib/image-bytes"
import { isUnloadedImage, toDataUrl } from "@/lib/image-utils"
import type { ImageAttachment } from "@/types"

/** How far past the visible edge an image may start loading, in pixels. */
const PRELOAD_MARGIN_PX = 240

/**
 * What an `<img>` needs for a stored image.
 *
 * `src` is a URL once the image can be shown, and `ref` goes on the element
 * that holds it. An image that carries its bytes becomes a data URL at once.
 * One that is only a stored-row reference is read when its holder is on or near
 * the screen — not when it merely mounts, since a virtualized list renders rows
 * past the edge too — and shown through an object URL, which the browser
 * decodes without a base64 string that size existing in the page. Once read it
 * stays until the image unmounts, so scrolling past never blanks a picture.
 */
export const useImageSource = (
  image: ImageAttachment
): { src: string | undefined; ref: RefObject<HTMLDivElement | null> } => {
  const unloaded = isUnloadedImage(image)
  const ref = useRef<HTMLDivElement>(null)
  const [near, setNear] = useState(false)
  const [objectUrl, setObjectUrl] = useState<string>()
  const rowId = image.id
  const { mimeType } = image

  useEffect(() => {
    if (!unloaded || near) return
    const element = ref.current
    if (!element || typeof IntersectionObserver === "undefined") {
      setNear(true)
      return
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) setNear(true)
      },
      { rootMargin: `${PRELOAD_MARGIN_PX}px` }
    )
    observer.observe(element)
    return () => observer.disconnect()
  }, [unloaded, near])

  useEffect(() => {
    if (!unloaded || !near || rowId === undefined) return
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
  }, [unloaded, near, rowId, mimeType])

  return {
    src: unloaded ? objectUrl : toDataUrl(image.mimeType, image.base64),
    ref
  }
}
