import { useState } from "react"
import { useTranslation } from "react-i18next"
import { Button } from "@/components/ui/button"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger
} from "@/components/ui/collapsible"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
  PreviewSheet,
  PreviewTextBlock
} from "@/features/chat/components/preview-sheet"
import type { FileProcessingState } from "@/lib/file-processors/types"
import { CircleCheck, FileText, Loader2, X } from "@/lib/lucide-icon"
import { cn } from "@/lib/utils"

interface ChatInputAttachmentSheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  processingStates: FileProcessingState[]
  onRemove: (file: File) => void
}

const formatFileSize = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function ChatInputAttachmentSheet({
  open,
  onOpenChange,
  processingStates,
  onRemove
}: ChatInputAttachmentSheetProps) {
  const { t } = useTranslation()
  const [expandedFile, setExpandedFile] = useState<string | null>(null)
  const successfulStates = processingStates.filter(
    (state) => state.status === "success"
  )

  return (
    <PreviewSheet
      open={open}
      onOpenChange={onOpenChange}
      title={t("chat.input.attachments", { count: successfulStates.length })}
      className="w-[min(32rem,calc(100vw-1rem))]">
      <ScrollArea className="min-h-0 flex-1 overflow-x-hidden">
        <div className="space-y-2 p-3">
          {successfulStates.length === 0 && (
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
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      className="size-7 shrink-0 rounded-control text-muted-foreground hover:text-foreground"
                      onClick={() => onRemove(state.file)}
                      aria-label={t("file_upload.preview.remove_aria_label")}>
                      <X className="icon-xs" />
                    </Button>
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
      </ScrollArea>
    </PreviewSheet>
  )
}
