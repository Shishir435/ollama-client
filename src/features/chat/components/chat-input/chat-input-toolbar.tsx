import { useTranslation } from "react-i18next"
import { TooltipActionButton } from "@/components/actions"
import { IconBadge } from "@/components/icon-badge"
import { SettingsButton } from "@/components/settings-button"
import { FileUploadButton } from "@/features/file-upload/components/file-upload-button"
import { ModelMenu } from "@/features/model/components/model-menu"
import { WebSearchToggle } from "@/features/web-search/components/web-search-toggle"
import type { FileProcessingState } from "@/lib/file-processors/types"
import { Camera, FileText } from "@/lib/lucide-icon"
import { ContextSettingsMenu } from "./context-settings-menu"
import { InputMetrics } from "./input-metrics"

export interface ChatInputToolbarProps {
  inputLength: number
  isLoading: boolean
  onFilesSelected: (files: FileList) => void
  processingStates?: FileProcessingState[]
  onAttachmentClick?: () => void
  acceptImages?: boolean
  /** Staged image count, shown in the same attachment badge as files. */
  imageCount?: number
  /** Capture the visible tab as an image (E1; shown only when enabled). */
  onCaptureScreenshot?: () => void
  showScreenshot?: boolean
}

export const ChatInputToolbar = ({
  inputLength,
  isLoading,
  onFilesSelected,
  processingStates = [],
  onAttachmentClick,
  acceptImages = false,
  imageCount = 0,
  onCaptureScreenshot,
  showScreenshot = false
}: ChatInputToolbarProps) => {
  const { t } = useTranslation()
  const successfulStates = processingStates.filter(
    (s) => s.status === "success"
  )
  const attachmentCount = successfulStates.length + imageCount

  return (
    <div className="absolute bottom-1 left-1 right-1 flex items-center justify-between gap-2 rounded-control bg-background/85 p-1 backdrop-blur">
      <div className="flex min-w-0 items-center gap-0.5">
        <ModelMenu
          showStatusPopup={false}
          tooltipTextContent={t("chat.input.switch_model")}
        />

        <ContextSettingsMenu />

        <WebSearchToggle />

        <SettingsButton
          showText={false}
          variant="ghost"
          size="icon"
          className="shrink-0 rounded-control text-muted-foreground hover:bg-muted/55 hover:text-foreground"
          iconClassName="icon-sm"
        />

        <FileUploadButton
          onFilesSelected={onFilesSelected}
          disabled={isLoading}
          acceptImages={acceptImages}
        />
        {showScreenshot && onCaptureScreenshot && (
          <TooltipActionButton
            type="button"
            variant="ghost"
            size="icon"
            className="shrink-0 rounded-control text-muted-foreground hover:bg-muted/55 hover:text-foreground"
            onClick={onCaptureScreenshot}
            disabled={isLoading}
            label={t("chat.input.screenshot")}
            icon={<Camera className="icon-sm" aria-hidden="true" />}
          />
        )}
        {attachmentCount > 0 && onAttachmentClick && (
          <TooltipActionButton
            type="button"
            variant="ghost"
            size="icon"
            className="relative shrink-0 rounded-control text-muted-foreground hover:bg-muted/55 hover:text-foreground"
            onClick={onAttachmentClick}
            label={t("chat.input.attachments", {
              count: attachmentCount
            })}
            icon={
              <IconBadge
                icon={<FileText className="icon-sm" aria-hidden="true" />}
                count={attachmentCount}
              />
            }
          />
        )}
      </div>

      <InputMetrics inputLength={inputLength} />
    </div>
  )
}
