import { FileIcon, FileText, Loader2 } from "lucide-react"
import { useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import { Badge } from "@/components/ui/badge"
import { ScrollArea } from "@/components/ui/scroll-area"
import { getAllDocuments } from "@/lib/embeddings/vector-store"
import { logger } from "@/lib/logger"
import type { FileAttachment } from "@/types"
import { CopyButton } from "./copy-button"
import { PreviewSheet, PreviewTextBlock } from "./preview-sheet"

export interface FileAttachmentDisplayProps {
  attachments: FileAttachment[]
}

function getFileIcon(fileType: string) {
  if (fileType === "application/pdf" || fileType.includes("document")) {
    return <FileText className="icon-xs" />
  }
  return <FileIcon className="icon-xs" />
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export interface FileViewerSheetProps {
  file: FileAttachment
}

function FileViewerSheet({ file }: FileViewerSheetProps) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [fullText, setFullText] = useState<string>("")
  const [isLoading, setIsLoading] = useState(false)
  const [expanded, setExpanded] = useState(true)

  useEffect(() => {
    if (!open) return

    setFullText(file.textPreview || "")
    if (!file.fileId) return

    async function fetchFullText() {
      setIsLoading(true)
      try {
        // Try to get full text from vector store
        const result = await getAllDocuments({
          fileId: file.fileId,
          type: "file"
        })

        if (result.documents.length > 0) {
          // Combine all chunks to get full text
          const combined = result.documents
            .map((doc) => doc.content)
            .join("\n\n")
          setFullText(combined)
        } else {
          // Fallback to preview if no documents found
          setFullText(file.textPreview || "No content available")
        }
      } catch (error) {
        logger.error("Failed to fetch file content", "FileAttachmentDisplay", {
          error
        })
        setFullText(
          file.textPreview || "Error loading content. Please try again."
        )
      } finally {
        setIsLoading(false)
      }
    }

    fetchFullText()
  }, [open, file.fileId, file.textPreview])

  const meta = (
    <>
      {file.fileType} • {formatFileSize(file.fileSize)}
      {file.processedAt && (
        <> • Processed {new Date(file.processedAt).toLocaleString()}</>
      )}
    </>
  )

  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        <Badge
          variant="secondary"
          className="cursor-pointer gap-1.5 pr-1 transition-colors hover:bg-secondary/80">
          {getFileIcon(file.fileType)}
          <span className="max-w-30 truncate">{file.fileName}</span>
          <span className="text-[10px] text-muted-foreground">
            {formatFileSize(file.fileSize)}
          </span>
        </Badge>
      </button>
      <PreviewSheet
        open={open}
        onOpenChange={setOpen}
        title={
          <span className="inline-flex min-w-0 items-center gap-2">
            {getFileIcon(file.fileType)}
            <span className="truncate">{file.fileName}</span>
          </span>
        }
        meta={meta}>
        <ScrollArea className="min-h-0 flex-1 overflow-x-hidden">
          <div className="p-3">
            <div className="overflow-hidden rounded-panel border border-border/35 bg-background/35">
              <div className="flex items-center gap-2 px-3 py-2">
                <button
                  type="button"
                  className="flex min-w-0 flex-1 items-center gap-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  onClick={() => setExpanded(!expanded)}>
                  {getFileIcon(file.fileType)}
                  <span className="min-w-0 flex-1 truncate text-sm font-medium">
                    {file.fileName}
                  </span>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {formatFileSize(file.fileSize)}
                  </span>
                  <span className="hidden shrink-0 text-xs text-muted-foreground min-[24rem]:inline">
                    {t("tabs.inspector.chars", { count: fullText.length })}
                  </span>
                </button>
                {fullText && <CopyButton text={fullText} />}
              </div>
              {expanded && (
                <div className="border-t border-border/35">
                  {isLoading ? (
                    <div className="flex items-center justify-center p-8 text-muted-foreground">
                      <Loader2 className="mr-2 size-6 animate-spin" />
                      <span className="text-sm">{t("common.loading")}</span>
                    </div>
                  ) : (
                    <div className="max-h-[min(32rem,65vh)] overflow-y-auto overflow-x-hidden">
                      <PreviewTextBlock
                        text={fullText}
                        emptyText="No text content available"
                      />
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </ScrollArea>
      </PreviewSheet>
    </>
  )
}

export function FileAttachmentDisplay({
  attachments
}: FileAttachmentDisplayProps) {
  if (!attachments || attachments.length === 0) {
    return null
  }

  return (
    <div className="flex flex-wrap gap-2 mb-2">
      {attachments.map((file, index) => (
        <FileViewerSheet key={file.fileId || index} file={file} />
      ))}
    </div>
  )
}
