import { useState } from "react"
import { useTranslation } from "react-i18next"
import { TooltipActionButton } from "@/components/actions"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger
} from "@/components/ui/collapsible"
import type { FileProcessingState } from "@/lib/file-processors/types"
import { toDataUrl } from "@/lib/image-utils"
import { CircleCheck, FileText, Loader2, X } from "@/lib/lucide-icon"
import { cn } from "@/lib/utils"
import type { ImageAttachment } from "@/types"
import { CopyButton } from "../copy-button"
import { PreviewTextBlock } from "../preview-sheet"

export interface AttachmentListProps {
  processingStates: FileProcessingState[]
  onRemove: (file: File) => void
  images?: ImageAttachment[]
  onRemoveImage?: (imageId: string) => void
}

const formatFileSize = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/**
 * Staged attachments (files + images) with expandable per-file previews and
 * remove buttons. Layout-agnostic: the parent owns scrolling and padding, so
 * it can live inline in the Context sheet or any future container.
 */
export function AttachmentList({
  processingStates,
  onRemove,
  images = [],
  onRemoveImage
}: AttachmentListProps) {
  const { t } = useTranslation()
  const [expandedFile, setExpandedFile] = useState<string | null>(null)
  const successfulStates = processingStates.filter(
    (state) => state.status === "success"
  )

  return (
    <div className="space-y-2">
      {images.length > 0 && (
        <div className="flex flex-wrap gap-2 pb-1">
          {images.map((image) => (
            <div
              key={image.imageId}
              className="group relative size-16 overflow-hidden rounded-panel border border-border/35 bg-background/35">
              <img
                src={toDataUrl(image.mimeType, image.base64)}
                alt={image.fileName}
                className="size-full object-cover"
              />
              {onRemoveImage && (
                <TooltipActionButton
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  className="absolute right-0.5 top-0.5 size-5 rounded-full bg-background/80 text-muted-foreground opacity-0 hover:text-foreground group-hover:opacity-100"
                  onClick={() => onRemoveImage(image.imageId)}
                  label={t("chat.input.images.remove", {
                    name: image.fileName
                  })}
                  icon={<X className="icon-xs" />}
                />
              )}
            </div>
          ))}
        </div>
      )}
      {successfulStates.length === 0 && images.length === 0 && (
        <p className="rounded-control border border-border/35 bg-background/35 p-3 text-xs text-muted-foreground">
          {t("file_upload.area.files_ready", { count: 0 })}
        </p>
      )}
      {successfulStates.map((state) => {
        const previewText = state.result?.text?.trim() ?? ""
        const previewCharCount = previewText.length
        const isOpen = expandedFile === state.file.name

        return (
          <Collapsible
            key={state.file.name}
            open={isOpen}
            onOpenChange={(nextOpen) =>
              setExpandedFile(nextOpen ? state.file.name : null)
            }>
            <div className="overflow-hidden rounded-panel border border-border/35 bg-background/35">
              <div className="flex min-w-0 items-center gap-2 px-3 py-2">
                {state.status === "processing" ? (
                  <Loader2 className="icon-sm shrink-0 animate-spin text-primary" />
                ) : (
                  <CircleCheck className="icon-sm shrink-0 text-status-success" />
                )}
                <CollapsibleTrigger
                  className={cn(
                    "flex min-w-0 flex-1 items-center gap-2 text-left",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  )}>
                  <FileText className="icon-sm shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1 truncate text-sm font-medium">
                    {state.file.name}
                  </span>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {formatFileSize(state.file.size)}
                  </span>
                  <span className="hidden shrink-0 text-xs text-muted-foreground min-[24rem]:inline">
                    {t("tabs.inspector.chars", {
                      count: previewCharCount
                    })}
                  </span>
                </CollapsibleTrigger>
                {previewText && <CopyButton text={previewText} />}
                <TooltipActionButton
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  className="size-7 shrink-0 rounded-control text-muted-foreground hover:text-foreground"
                  onClick={() => onRemove(state.file)}
                  label={t("file_upload.preview.remove_aria_label")}
                  icon={<X className="icon-xs" />}
                />
              </div>
              <CollapsibleContent>
                <div className="border-t border-border/35">
                  <div className="max-h-[min(22rem,45vh)] overflow-y-auto overflow-x-hidden">
                    <PreviewTextBlock
                      text={previewText}
                      emptyText={t("file_upload.area.files_ready", {
                        count: 1
                      })}
                      className="p-3"
                    />
                  </div>
                </div>
              </CollapsibleContent>
            </div>
          </Collapsible>
        )
      })}
    </div>
  )
}
