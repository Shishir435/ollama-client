import { useTranslation } from "react-i18next"
import { toDataUrl } from "@/lib/image-utils"
import { X } from "@/lib/lucide-icon"
import { cn } from "@/lib/utils"
import type { ImageAttachment } from "@/types"

interface ImageAttachmentRailProps {
  images: ImageAttachment[]
  onRemove: (imageId: string) => void
  className?: string
}

/**
 * Horizontal rail of staged image thumbnails shown above the composer input.
 * Separate from the RAG file chips — these are message-scoped images for
 * vision models.
 */
export const ImageAttachmentRail = ({
  images,
  onRemove,
  className
}: ImageAttachmentRailProps) => {
  const { t } = useTranslation()

  if (images.length === 0) return null

  return (
    <div className={cn("flex flex-wrap gap-2 px-3 pt-2", className)}>
      {images.map((image) => (
        <div
          key={image.imageId}
          className="group relative size-14 overflow-hidden rounded-md border border-border/60 bg-muted/30">
          <img
            src={toDataUrl(image.mimeType, image.base64)}
            alt={image.fileName}
            className="size-full object-cover"
          />
          <button
            type="button"
            aria-label={t("chat.input.images.remove", {
              name: image.fileName
            })}
            onClick={() => onRemove(image.imageId)}
            className="absolute right-0.5 top-0.5 flex size-4 items-center justify-center rounded-full bg-background/80 text-muted-foreground opacity-0 transition-opacity hover:text-foreground group-hover:opacity-100">
            <X className="icon-xs" />
          </button>
        </div>
      ))}
    </div>
  )
}
