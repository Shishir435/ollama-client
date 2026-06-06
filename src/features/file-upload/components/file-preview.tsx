import { useTranslation } from "react-i18next"

import { Button } from "@/components/ui/button"
import {
  Popover,
  PopoverContent,
  PopoverTrigger
} from "@/components/ui/popover"
import { Progress } from "@/components/ui/progress"
import { FILE_UPLOAD } from "@/lib/constants"
import type { FileProcessingState } from "@/lib/file-processors/types"
import {
  AlertCircle,
  CircleCheck,
  FileText,
  Loader2,
  X
} from "@/lib/lucide-icon"
import { cn } from "@/lib/utils"

export interface FilePreviewProps {
  processingState: FileProcessingState
  onRemove: () => void
}

export const FilePreview = ({
  processingState,
  onRemove
}: FilePreviewProps) => {
  const { t } = useTranslation()
  const { file, status, error, progress } = processingState
  const previewText = processingState.result?.text?.trim()
  const previewCharCount = previewText?.length ?? 0

  const formatFileSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  }

  const getStatusColor = () => {
    switch (status) {
      case "processing":
      case "success":
        return "border-border/50 bg-muted/30"
      case "error":
        return "border-destructive/50 bg-destructive/10"
      default:
        return "border-border/50 bg-muted/30"
    }
  }

  const getFileTypeIcon = () => {
    const extension = file.name.split(".").pop()?.toLowerCase()
    switch (extension) {
      case FILE_UPLOAD.EXTENSIONS.PDF:
        return <FileText className="size-4 text-status-danger/80" />
      case FILE_UPLOAD.EXTENSIONS.DOCX:
        return <FileText className="size-4 text-status-info/80" />
      case FILE_UPLOAD.EXTENSIONS.CSV:
      case FILE_UPLOAD.EXTENSIONS.TSV:
        return <FileText className="size-4 text-status-success/80" />
      case FILE_UPLOAD.EXTENSIONS.HTML:
      case FILE_UPLOAD.EXTENSIONS.HTM:
        return <FileText className="size-4 text-status-warning/80" />
      default:
        return <FileText className="size-4 text-muted-foreground/50" />
    }
  }

  const getStatusIcon = () => {
    switch (status) {
      case "processing":
        return <Loader2 className="size-4 animate-spin text-primary/80" />
      case "success":
        return <CircleCheck className="size-4 text-status-success" />
      case "error":
        return <AlertCircle className="size-4 text-destructive/80" />
      default:
        return getFileTypeIcon()
    }
  }

  const getProcessingMessage = (): string => {
    if (progress && progress > 0) {
      return t("file_upload.preview.generating_embeddings")
    }
    const extension = file.name.split(".").pop()?.toLowerCase()

    // Check file type
    if (extension === FILE_UPLOAD.EXTENSIONS.PDF) {
      return t("file_upload.preview.extracting_pdf")
    }
    if (extension === FILE_UPLOAD.EXTENSIONS.DOCX) {
      return t("file_upload.preview.processing_docx")
    }
    if (
      extension === FILE_UPLOAD.EXTENSIONS.CSV ||
      extension === FILE_UPLOAD.EXTENSIONS.TSV
    ) {
      return t("file_upload.preview.processing_csv")
    }
    if (
      extension === FILE_UPLOAD.EXTENSIONS.HTML ||
      extension === FILE_UPLOAD.EXTENSIONS.HTM
    ) {
      return t("file_upload.preview.processing_html")
    }
    return t("file_upload.preview.processing_file")
  }

  return (
    <div className="group relative">
      <Popover>
        <div
          className={cn(
            "flex h-7 max-w-[min(24rem,100%)] items-center rounded-chip border text-xs transition-colors",
            getStatusColor()
          )}>
          <PopoverTrigger
            render={
              <button
                type="button"
                className="flex min-w-0 flex-1 items-center gap-1.5 px-2"
              />
            }>
            {getStatusIcon()}
            <span className="min-w-0 truncate font-medium">{file.name}</span>
            <span className="shrink-0 text-muted-foreground">
              {formatFileSize(file.size)}
            </span>
          </PopoverTrigger>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="mr-0.5 size-5 shrink-0 rounded-full text-muted-foreground hover:text-foreground"
            onClick={onRemove}
            aria-label={t("file_upload.preview.remove_aria_label")}>
            <X className="size-3" />
          </Button>
        </div>
        <PopoverContent
          align="start"
          sideOffset={6}
          className="max-h-[min(30rem,calc(100vh-8rem))] w-[min(24rem,calc(100vw-1.25rem))] rounded-panel p-3">
          <div className="flex items-start gap-2">
            {getStatusIcon()}
            <div className="min-w-0 flex-1">
              <div className="break-all text-sm font-medium">{file.name}</div>
              <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
                <span>{formatFileSize(file.size)}</span>
                {status === "success" && (
                  <span>
                    {t("tabs.inspector.chars", { count: previewCharCount })}
                  </span>
                )}
              </div>
            </div>
          </div>
          {status === "processing" && (
            <div className="mt-3">
              <div className="mb-1 flex items-center justify-between text-xs text-muted-foreground">
                <span>{getProcessingMessage()}</span>
                <span>{Math.round(progress || 0)}%</span>
              </div>
              <Progress value={progress || 0} className="h-1" />
            </div>
          )}
          {status === "success" && (
            <div className="mt-3 max-h-64 overflow-y-auto rounded-control border border-border/35 bg-background/35">
              <pre className="whitespace-pre-wrap break-words p-2 font-sans text-xs leading-relaxed text-muted-foreground">
                {previewText || t("file_upload.area.files_ready", { count: 1 })}
              </pre>
            </div>
          )}
          {status === "error" && error && (
            <div className="mt-3 text-xs text-destructive">{error}</div>
          )}
        </PopoverContent>
      </Popover>
    </div>
  )
}
