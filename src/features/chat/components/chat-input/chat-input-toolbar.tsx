import { useTranslation } from "react-i18next"
import { SettingsButton } from "@/components/settings-button"
import { Button } from "@/components/ui/button"
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
}

export const ChatInputToolbar = ({
  inputLength,
  isLoading,
  onFilesSelected,
  processingStates = [],
  onAttachmentClick
}: ChatInputToolbarProps) => {
  const { t } = useTranslation()
  const successfulStates = processingStates.filter(
    (s) => s.status === "success"
  )
  const attachmentCount = successfulStates.length

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
        />
        {attachmentCount > 0 && onAttachmentClick && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="relative size-8 rounded-control text-muted-foreground hover:bg-muted/55 hover:text-foreground"
            onClick={onAttachmentClick}
            aria-label={t("chat.input.attachments", {
              count: attachmentCount
            })}>
            <div className="relative">
              <FileText className="icon-md" />
              <span className="absolute -right-1 -top-1 flex size-2.5 items-center justify-center rounded-chip bg-primary text-[7px] font-bold text-primary-foreground">
                {attachmentCount}
              </span>
            </div>
          </Button>
        )}
      </div>

      <InputMetrics inputLength={inputLength} />
    </div>
  )
}
