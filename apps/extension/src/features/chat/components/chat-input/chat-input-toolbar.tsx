import { useTranslation } from "react-i18next"
import { SettingsButton } from "@/components/settings-button"
import { FileUploadButton } from "@/features/file-upload/components/file-upload-button"
import { ModelMenu } from "@/features/model/components/model-menu"
import { ContextSettingsMenu } from "./context-settings-menu"
import { InputMetrics } from "./input-metrics"

interface ChatInputToolbarProps {
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
    <div className="absolute bottom-1 left-1 right-1 flex items-center justify-between rounded-xl bg-muted/20 px-2 py-1.5 backdrop-blur-md transition-colors hover:bg-muted/30">
      <div className="flex items-center gap-1.5">
        <ModelMenu
          showStatusPopup={false}
          tooltipTextContent={t("chat.input.switch_model")}
        />

        <ContextSettingsMenu />

        <SettingsButton
          showText={false}
          variant="ghost"
          size="icon"
          className="size-8 rounded-lg"
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
