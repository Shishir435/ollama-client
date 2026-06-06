import { useTranslation } from "react-i18next"
import { SettingsButton } from "@/components/settings-button"
import { FileUploadButton } from "@/features/file-upload/components/file-upload-button"
import { ModelMenu } from "@/features/model/components/model-menu"
import { ContextSettingsMenu } from "./context-settings-menu"
import { InputMetrics } from "./input-metrics"

export interface ChatInputToolbarProps {
  inputLength: number
  isLoading: boolean
  onFilesSelected: (files: FileList) => void
}

export const ChatInputToolbar = ({
  inputLength,
  isLoading,
  onFilesSelected
}: ChatInputToolbarProps) => {
  const { t } = useTranslation()

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
          iconClassName="size-4"
        />

        <FileUploadButton
          onFilesSelected={onFilesSelected}
          disabled={isLoading}
        />
      </div>

      <InputMetrics inputLength={inputLength} />
    </div>
  )
}
