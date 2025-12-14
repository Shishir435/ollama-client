import { useTranslation } from "react-i18next"

import { Button } from "@/components/ui/button"
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

interface FilePreviewProps {
  processingState: FileProcessingState
  onRemove: () => void
}

export const FilePreview = ({
  processingState,
  onRemove
}: FilePreviewProps) => {
  const { t } = useTranslation()
  const { file, status, error, progress } = processingState

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
        return <FileText className="size-4 text-red-500/80" />
      case FILE_UPLOAD.EXTENSIONS.DOCX:
        return <FileText className="size-4 text-blue-500/80" />
      case FILE_UPLOAD.EXTENSIONS.CSV:
      case FILE_UPLOAD.EXTENSIONS.TSV:
        return <FileText className="size-4 text-green-500/80" />
      case FILE_UPLOAD.EXTENSIONS.HTML:
      case FILE_UPLOAD.EXTENSIONS.HTM:
        return <FileText className="size-4 text-orange-500/80" />
      default:
        return <FileText className="size-4 text-muted-foreground/50" />
    }
  }

  const getStatusIcon = () => {
    switch (status) {
      case "processing":
        return <Loader2 className="size-4 animate-spin text-primary/80" />
      case "success":
        return <CircleCheck className="size-4 text-green-500" />
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
      return t("file_upload.preview.processing_csv", {
        defaultValue: "Parsing CSV file..."
      })
    }
    if (
      extension === FILE_UPLOAD.EXTENSIONS.HTML ||
      extension === FILE_UPLOAD.EXTENSIONS.HTM
    ) {
      return t("file_upload.preview.processing_html", {
        defaultValue: "Converting HTML to Markdown..."
      })
    }
    return t("file_upload.preview.processing_file")
  }

  return (
    <div
      className={cn(
        "group relative flex items-center gap-2 rounded-lg border p-2 text-sm transition-all",
        getStatusColor()
      )}>
      {getStatusIcon()}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="truncate font-medium">{file.name}</span>
          <span className="text-xs text-muted-foreground">
            {formatFileSize(file.size)}
          </span>
        </div>
        {status === "processing" && (
          <div className="mt-1">
            <div className="mb-1 flex items-center justify-between text-xs text-muted-foreground">
              <span>{getProcessingMessage()}</span>
              <span>{Math.round(progress || 0)}%</span>
            </div>
            <Progress value={progress || 0} className="h-1" />
          </div>
        )}
        {status === "error" && error && (
          <div className="mt-1 text-xs text-destructive">{error}</div>
        )}
      </div>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="h-6 w-6 shrink-0 opacity-70 transition-opacity hover:opacity-100"
        onClick={onRemove}
        aria-label={t("file_upload.preview.remove_aria_label")}>
        <X className="h-3 w-3" />
      </Button>
    </div>
  )
}
