import { useState } from "react"
import { useTranslation } from "react-i18next"

import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle
} from "@/components/ui/sheet"
import { toDataUrl } from "@/lib/image-utils"
import type { ImageAttachment } from "@/types"

interface MessageImageDisplayProps {
  images: ImageAttachment[]
}

/**
 * Thumbnails of the images attached to a sent message. Clicking one opens it
 * full-size in a sheet. Separate from `FileAttachmentDisplay` (RAG files).
 */
export const MessageImageDisplay = ({ images }: MessageImageDisplayProps) => {
  const { t } = useTranslation()
  const [active, setActive] = useState<ImageAttachment | null>(null)

  if (!images || images.length === 0) return null

  return (
    <>
      <div className="mb-2 flex flex-wrap gap-2">
        {images.map((image) => (
          <button
            key={image.imageId}
            type="button"
            onClick={() => setActive(image)}
            aria-label={t("chat.message.images.view", { name: image.fileName })}
            className="size-20 overflow-hidden rounded-md border border-border/40 bg-muted/30 transition-opacity hover:opacity-90">
            <img
              src={toDataUrl(image.mimeType, image.base64)}
              alt={image.fileName}
              className="size-full object-cover"
            />
          </button>
        ))}
      </div>

      <Sheet open={active !== null} onOpenChange={(o) => !o && setActive(null)}>
        <SheetContent side="right" className="w-full gap-0 sm:max-w-lg">
          <SheetHeader className="border-b">
            <SheetTitle className="truncate">{active?.fileName}</SheetTitle>
          </SheetHeader>
          <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto p-4">
            {active && (
              <img
                src={toDataUrl(active.mimeType, active.base64)}
                alt={active.fileName}
                className="max-h-full max-w-full rounded-md object-contain"
              />
            )}
          </div>
        </SheetContent>
      </Sheet>
    </>
  )
}
