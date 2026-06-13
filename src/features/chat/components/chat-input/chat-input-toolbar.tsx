import { useTranslation } from "react-i18next"
import { TooltipActionButton } from "@/components/actions"
import { IconBadge } from "@/components/icon-badge"
import { SettingsButton } from "@/components/settings-button"
import { FileUploadButton } from "@/features/file-upload/components/file-upload-button"
import { ModelMenu } from "@/features/model/components/model-menu"
import type { FileProcessingState } from "@/lib/file-processors/types"
import { FileText } from "@/lib/lucide-icon"
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
}

export const ChatInputToolbar = ({
  inputLength,
  isLoading,
  onFilesSelected,
  processingStates = [],
  onAttachmentClick,
  acceptImages = false,
  imageCount = 0
}: ChatInputToolbarProps) => {
  const { t } = useTranslation()
  const successfulStates = processingStates.filter(
    (s) => s.status === "success"
  )
  const attachmentCount = successfulStates.length + imageCount

  return (
    <div className="absolute bottom-1 left-1 right-1 flex items-center justify-between gap-2 rounded-control bg-background/85 px-2 py-2 backdrop-blur">
      <div className="flex min-w-0 items-center gap-1">
        <ModelMenu
          showStatusPopup={false}
          tooltipTextContent={t("chat.input.switch_model")}
        />

        <ContextSettingsMenu />

        <SettingsButton
          showText={false}
          variant="ghost"
          size="icon"
          className="size-8 shrink-0 rounded-control text-muted-foreground hover:bg-muted/55 hover:text-foreground"
          iconClassName="icon-md"
        />

        <FileUploadButton
          onFilesSelected={onFilesSelected}
          disabled={isLoading}
          acceptImages={acceptImages}
        />
        {attachmentCount > 0 && onAttachmentClick && (
          <TooltipActionButton
            type="button"
            variant="ghost"
            size="icon"
            className="relative size-8 rounded-control text-muted-foreground hover:bg-muted/55 hover:text-foreground"
            onClick={onAttachmentClick}
            label={t("chat.input.attachments", {
              count: attachmentCount
            })}
            icon={
              <IconBadge
                icon={<FileText className="icon-md" aria-hidden="true" />}
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
