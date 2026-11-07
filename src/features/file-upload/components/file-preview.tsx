import {
  AlertCircle,
  CircleCheck,
  Clock,
  FileText,
  Loader2,
  X
} from "lucide-react"
import { useTranslation } from "react-i18next"
import { TooltipActionButton } from "@/components/actions"
import {
  Popover,
  PopoverContent,
  PopoverTrigger
} from "@/components/ui/popover"
import { Progress } from "@/components/ui/progress"
import { cn } from "@/lib/class-names"
import { FILE_UPLOAD } from "@/lib/constants"
import type { FileProcessingState } from "@/lib/file-processors/types"

export interface FilePreviewProps {
  processingState: FileProcessingState
  onRemove: () => void
  compact?: boolean
}

export const FilePreview = ({
  processingState,
  onRemove,
  compact = false
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
        return "border-border bg-surface-sunken"
      case "error":
        return "border-destructive/50 bg-tint-danger"
      default:
        return "border-border bg-surface-sunken"
    }
  }

  const getFileTypeIcon = () => {
    const extension = file.name.split(".").pop()?.toLowerCase()
    switch (extension) {
      case FILE_UPLOAD.EXTENSIONS.PDF:
        return <FileText className="icon-md text-status-danger-text/80" />
      case FILE_UPLOAD.EXTENSIONS.DOCX:
        return <FileText className="icon-md text-status-info-text/80" />
      case FILE_UPLOAD.EXTENSIONS.CSV:
      case FILE_UPLOAD.EXTENSIONS.TSV:
        return <FileText className="icon-md text-status-success-text/80" />
      case FILE_UPLOAD.EXTENSIONS.HTML:
      case FILE_UPLOAD.EXTENSIONS.HTM:
        return <FileText className="icon-md text-status-warning-text/80" />
      default:
        return <FileText className="icon-md text-foreground-tertiary" />
    }
  }

  const getStatusIcon = () => {
    switch (status) {
      case "queued":
        return <Clock className="icon-md text-muted-foreground" />
      case "processing":
        return <Loader2 className="icon-md animate-spin text-primary/80" />
      case "success":
        return <CircleCheck className="icon-md text-status-success-text" />
      case "error":
        return <AlertCircle className="icon-md text-destructive/80" />
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

  /** Name, state and any error in one string, so the chip says what the icon only shows. */
  const accessibleName =
    status === "error" && error
      ? t("file_upload.preview.aria_label_error", {
          name: file.name,
          status: t("file_upload.preview.status.error"),
          error
        })
      : t("file_upload.preview.aria_label", {
          name: file.name,
          status: t(`file_upload.preview.status.${status}`)
        })

  return (
    <div
      className={cn(
        "group relative min-w-0 shrink-0",
        compact ? "max-w-max" : "max-w-[min(16rem,calc(100vw-6rem))]"
      )}>
      <Popover>
        <div
          className={cn(
            "flex h-7 max-w-full items-center rounded-chip border text-xs transition-colors",
            compact && "h-8",
            getStatusColor()
          )}>
          <PopoverTrigger
            render={
              <button
                type="button"
                className={cn(
                  "flex min-w-0 flex-1 items-center justify-center gap-1.5 overflow-hidden px-2",
                  compact && "size-8 px-0"
                )}
                aria-label={accessibleName}
              />
            }>
            {getStatusIcon()}
            {!compact && (
              <>
                <span className="min-w-0 truncate font-medium">
                  {file.name}
                </span>
                <span className="hidden shrink-0 text-muted-foreground min-[36rem]:inline">
                  {formatFileSize(file.size)}
                </span>
              </>
            )}
          </PopoverTrigger>
          <TooltipActionButton
            type="button"
            variant="ghost"
            size={compact ? "icon-sm" : "icon-xs"}
            className={cn(
              "mr-0.5 shrink-0 rounded-full text-muted-foreground hover:text-foreground",
              compact && "mr-1"
            )}
            onClick={onRemove}
            label={t("file_upload.preview.remove_aria_label")}
            icon={<X className="icon-xs" />}
          />
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
          {status === "queued" && (
            <p className="mt-3 text-xs text-muted-foreground">
              {t("file_upload.preview.status.queued")}
            </p>
          )}
          {status === "processing" && (
            <div className="mt-3">
              <div className="mb-1 flex items-center justify-between text-xs text-muted-foreground">
                <span>{getProcessingMessage()}</span>
                {progress !== undefined && <span>{Math.round(progress)}%</span>}
              </div>
              {/** No real progress is reported until the work finishes, so the bar is indeterminate rather than a fake 0 then 100. */}
              <Progress
                value={progress ?? null}
                className={cn(
                  "h-1",
                  progress === undefined &&
                    "**:data-[slot=progress-indicator]:w-1/3 **:data-[slot=progress-indicator]:animate-pulse"
                )}
              />
            </div>
          )}
          {status === "success" && (
            <div className="mt-3 max-h-64 overflow-y-auto rounded-control border border-border bg-surface-sunken">
              <pre className="whitespace-pre-wrap wrap-break-word p-2 font-sans text-xs leading-relaxed text-muted-foreground">
                {previewText || t("file_upload.area.files_ready", { count: 1 })}
              </pre>
            </div>
          )}
          {status === "error" && error && (
            <div className="mt-3 text-xs text-destructive">{error}</div>
          )}
        </PopoverContent>
      </Popover>
      {status === "error" && error && (
        <p
          role="alert"
          className={cn(
            "mt-0.5 line-clamp-2 wrap-break-word text-2xs text-destructive",
            compact && "max-w-40"
          )}>
          {error}
        </p>
      )}
    </div>
  )
}
