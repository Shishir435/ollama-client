import { Button } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"
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
        return "border-blue-500/50 bg-blue-500/10"
      case "success":
        return "border-green-500/50 bg-green-500/10"
      case "error":
        return "border-red-500/50 bg-red-500/10"
      default:
        return "border-border/50 bg-muted/30"
    }
  }

  const getStatusIcon = () => {
    switch (status) {
      case "processing":
        return "⏳"
      case "success":
        return "✓"
      case "error":
        return "✗"
      default:
        return "📄"
    }
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
            <Progress value={progress || 0} className="h-1" />
          </div>
        )}
        {status === "error" && error && (
          <div className="mt-1 text-xs text-red-500">{error}</div>
        )}
        {status === "success" && (
          <div className="mt-1 text-xs text-green-500">Ready to send</div>
        )}
      </div>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="h-6 w-6 shrink-0 opacity-0 transition-opacity group-hover:opacity-100"
        onClick={onRemove}
        aria-label="Remove file">
        <X className="h-3 w-3" />
      </Button>
    </div>
  )
}
