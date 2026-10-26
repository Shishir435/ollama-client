import { useState } from "react"
import { useTranslation } from "react-i18next"
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle
} from "@/components/ui/sheet"
import { useImageSource } from "@/features/chat/hooks/use-image-source"
import type { ImageAttachment } from "@/types"

interface MessageImageDisplayProps {
  images: ImageAttachment[]
  generated?: boolean
}

const ImageView = ({
  image,
  className
}: {
  image: ImageAttachment
  className: string
}) => {
  const { src, ref } = useImageSource(image)
  return src ? (
    <img src={src} alt={image.fileName} className={className} />
  ) : (
    <div
      ref={ref}
      aria-hidden="true"
      className={`${className} min-h-24 min-w-24 bg-surface-sunken`}
    />
  )
}

/**
 * User-image thumbnails or large generated-image previews. Clicking one opens
 * it full-size in a sheet. Separate from `FileAttachmentDisplay` (RAG files).
 */
export const MessageImageDisplay = ({
  images,
  generated = false
}: MessageImageDisplayProps) => {
  const { t } = useTranslation()
  const [active, setActive] = useState<ImageAttachment | null>(null)

  if (!images || images.length === 0) return null

  return (
    <>
      <div
        className={generated ? "mb-3 grid gap-2" : "mb-2 flex flex-wrap gap-2"}>
        {images.map((image) => (
          <button
            key={image.imageId}
            type="button"
            onClick={() => setActive(image)}
            aria-label={t("chat.message.images.view", { name: image.fileName })}
            className={
              generated
                ? "max-h-[32rem] w-fit max-w-full overflow-hidden rounded-control border border-border bg-surface-sunken transition-opacity hover:opacity-90"
                : "size-20 overflow-hidden rounded-control border border-border bg-surface-sunken transition-opacity hover:opacity-90"
            }>
            <ImageView
              image={image}
              className={
                generated
                  ? "max-h-[32rem] max-w-full object-contain"
                  : "size-full object-cover"
              }
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
              <ImageView
                image={active}
                className="max-h-full max-w-full rounded-control object-contain"
              />
            )}
          </div>
        </SheetContent>
      </Sheet>
    </>
  )
}
