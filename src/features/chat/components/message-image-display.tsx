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

const FAILED_CLASS =
  "flex min-h-24 min-w-24 flex-col items-center justify-center gap-1 bg-surface-sunken p-2 text-center text-muted-foreground text-xs"

/** The picture itself, for a place that is not already a button. */
const ImageView = ({
  image,
  className
}: {
  image: ImageAttachment
  className: string
}) => {
  const { t } = useTranslation()
  const { src, ref, failed, retry } = useImageSource(image)
  if (failed) {
    return (
      <span className={`${className} ${FAILED_CLASS}`}>
        {t("chat.message.images.unavailable")}
        <button type="button" onClick={retry} className="underline">
          {t("chat.message.images.retry")}
        </button>
      </span>
    )
  }
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
 * One thumbnail. It is the button, so a failed read cannot put a second button
 * inside it: pressing it retries the read instead of opening the full view.
 */
const ImageThumb = ({
  image,
  generated,
  onOpen
}: {
  image: ImageAttachment
  generated: boolean
  onOpen: () => void
}) => {
  const { t } = useTranslation()
  const { src, ref, failed, retry } = useImageSource(image)
  const imageClass = generated
    ? "max-h-[32rem] max-w-full object-contain"
    : "size-full object-cover"
  return (
    <button
      type="button"
      onClick={failed ? retry : onOpen}
      aria-label={
        failed
          ? t("chat.message.images.retry_named", { name: image.fileName })
          : t("chat.message.images.view", { name: image.fileName })
      }
      className={
        generated
          ? "max-h-[32rem] w-fit max-w-full overflow-hidden rounded-control border border-border bg-surface-sunken transition-opacity hover:opacity-90"
          : "size-20 overflow-hidden rounded-control border border-border bg-surface-sunken transition-opacity hover:opacity-90"
      }>
      {failed ? (
        <span className={`${imageClass} ${FAILED_CLASS}`}>
          {t("chat.message.images.unavailable")}
          <span className="underline">{t("chat.message.images.retry")}</span>
        </span>
      ) : src ? (
        <img src={src} alt={image.fileName} className={imageClass} />
      ) : (
        <div
          ref={ref}
          aria-hidden="true"
          className={`${imageClass} min-h-24 min-w-24 bg-surface-sunken`}
        />
      )}
    </button>
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
  const [active, setActive] = useState<ImageAttachment | null>(null)

  if (!images || images.length === 0) return null

  return (
    <>
      <div
        className={generated ? "mb-3 grid gap-2" : "mb-2 flex flex-wrap gap-2"}>
        {images.map((image) => (
          <ImageThumb
            key={image.imageId}
            image={image}
            generated={generated}
            onOpen={() => setActive(image)}
          />
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
