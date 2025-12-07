import { useTranslation } from "react-i18next"
import { SettingsButton } from "@/components/settings-button"
import { CharCount } from "@/features/chat/components/char-count"
import { RAGToggle } from "@/features/chat/components/rag-toggle"
import { FileUploadButton } from "@/features/file-upload/components/file-upload-button"
import { ModelMenu } from "@/features/model/components/model-menu"
import { TabsToggle } from "@/features/tabs/components/tabs-toggle"

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
    <div className="absolute bottom-0 left-0 right-0 flex items-center justify-between rounded-b-xl border-t border-border/30 bg-muted/30 p-2">
      <div className="flex items-center gap-2">
        <ModelMenu
          showStatusPopup={false}
          tooltipTextContent={t("chat.input.switch_model")}
        />
        <div className="flex items-center gap-1">
          <TabsToggle />
          <RAGToggle />
          <SettingsButton showText={false} />
        </div>
        <div className="flex items-center gap-2">
          <FileUploadButton
            onFilesSelected={onFilesSelected}
            disabled={isLoading}
          />
        </div>
      </div>

      <div className="flex items-center gap-3">
        <CharCount count={inputLength} />
        <div className="hidden text-xs text-muted-foreground sm:block">
          <kbd className="rounded bg-muted px-1.5 py-0.5 text-xs">
            {t("chat.input.enter_key")}
          </kbd>{" "}
          {t("chat.input.enter_to_send")}
        </div>
      </div>
    </div>
  )
}
