import { useStorage } from "@plasmohq/storage/hook"
import { useTranslation } from "react-i18next"
import { SettingsButton } from "@/components/settings-button"
import { AgentModeToggle } from "@/features/chat/components/agent-mode-toggle"
import { AutoRepeatToggle } from "@/features/chat/components/auto-repeat-toggle"
import { VisionModeToggle } from "@/features/chat/components/vision-mode-toggle"
import { FileUploadButton } from "@/features/file-upload/components/file-upload-button"
import { ModelMenu } from "@/features/model/components/model-menu"
import { useIsVisionCapable } from "@/features/model/hooks/use-is-vision-capable"
import { STORAGE_KEYS } from "@/lib/constants"
import { plasmoGlobalStorage } from "@/lib/plasmo-global-storage"
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
  const [selectedModel] = useStorage({
    key: STORAGE_KEYS.PROVIDER.SELECTED_MODEL,
    instance: plasmoGlobalStorage
  })
  const [selectedModelRef] = useStorage({
    key: STORAGE_KEYS.PROVIDER.SELECTED_MODEL_REF,
    instance: plasmoGlobalStorage
  })

  const isVisionCapable = useIsVisionCapable(
    (selectedModelRef as any)?.modelId || (selectedModel as string),
    (selectedModelRef as any)?.providerId
  )

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

        <div className="mx-1 h-4 w-px bg-border/50" />

        <AgentModeToggle />
        {isVisionCapable && <VisionModeToggle />}
        <AutoRepeatToggle />
      </div>

      <InputMetrics inputLength={inputLength} />
    </div>
  )
}
