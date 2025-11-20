import { Button } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"
import { FILE_UPLOAD } from "@/lib/constants"
import type { FileProcessingState } from "@/lib/file-processors/types"
import { X } from "@/lib/lucide-icon"
import { cn } from "@/lib/utils"

interface FilePreviewProps {
  processingState: FileProcessingState
  onRemove: () => void
}

export const FilePreview = ({
  processingState,
  onRemove
}: FilePreviewProps) => {
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

  const getFileTypeIcon = (): string => {
    const extension = file.name.split(".").pop()?.toLowerCase()
    switch (extension) {
      case FILE_UPLOAD.EXTENSIONS.PDF:
        return "📕"
      case FILE_UPLOAD.EXTENSIONS.DOCX:
        return "📘"
      default:
        return "📄"
    }
  }

  const getStatusIcon = () => {
    switch (status) {
      case "processing":
        return "⏳"
      case "error":
        return "✗"
      default:
        return getFileTypeIcon()
    }
  }

  const getProcessingMessage = (): string => {
    const extension = file.name.split(".").pop()?.toLowerCase()
    if (extension === FILE_UPLOAD.EXTENSIONS.PDF) {
      return "Extracting text from PDF..."
    }
    if (extension === FILE_UPLOAD.EXTENSIONS.DOCX) {
      return "Processing DOCX document..."
    }
    return "Processing file..."
  }

  return (
    <div
      className={cn(
        "group relative flex items-center gap-2 rounded-lg border p-2 text-sm transition-all",
        getStatusColor()
      )}>
      <span className="text-base">{getStatusIcon()}</span>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="truncate font-medium">{file.name}</span>
          <span className="text-xs text-muted-foreground">
            {formatFileSize(file.size)}
          </span>
        </div>
        {status === "processing" && (
          <div className="mt-1">
            <div className="mb-1 text-xs text-muted-foreground">
              {getProcessingMessage()}
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
        aria-label="Remove file">
        <X className="h-3 w-3" />
      </Button>
    </div>
  )
}
