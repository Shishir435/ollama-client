import { useTranslation } from "react-i18next"
import { SettingsButton } from "@/components/settings-button"
import { ModelMenu } from "@/features/model/components/model-menu"
import type { FileProcessingState } from "@/lib/file-processors/types"
import type { ImageAttachment } from "@/types"
import { ContextSettingsMenu } from "./context-settings-menu"
import { InputMetrics } from "./input-metrics"
import { VoiceInputButton } from "./voice-input-button"

export interface ChatInputToolbarProps {
  inputLength: number
  isLoading: boolean
  onFilesSelected: (files: FileList) => void
  processingStates?: FileProcessingState[]
  /** Remove a staged file (Context sheet's inline attachment list). */
  onRemoveFile?: (file: File) => void
  acceptImages?: boolean
  /** Staged images, shown in the same attachment view as files. */
  images?: ImageAttachment[]
  onRemoveImage?: (imageId: string) => void
  /** Capture the visible tab as an image (E1; shown only when enabled). */
  onCaptureScreenshot?: () => void
  showScreenshot?: boolean
}

export const ChatInputToolbar = ({
  inputLength,
  isLoading,
  onFilesSelected,
  processingStates = [],
  onRemoveFile,
  acceptImages = false,
  images = [],
  onRemoveImage,
  onCaptureScreenshot,
  showScreenshot = false
}: ChatInputToolbarProps) => {
  const { t } = useTranslation()
  const successfulStates = processingStates.filter(
    (s) => s.status === "success"
  )
  const attachmentCount = successfulStates.length + images.length

  return (
    <div className="absolute bottom-1 left-1 right-1 flex items-center justify-between gap-2 rounded-control bg-background/85 p-1 backdrop-blur">
      <div className="flex min-w-0 items-center gap-0.5">
        <ModelMenu
          showStatusPopup={false}
          tooltipTextContent={t("chat.input.switch_model")}
        />

        <ContextSettingsMenu
          attachmentCount={attachmentCount}
          onFilesSelected={onFilesSelected}
          disabled={isLoading}
          acceptImages={acceptImages}
          processingStates={processingStates}
          onRemoveFile={onRemoveFile}
          images={images}
          onRemoveImage={onRemoveImage}
          onCaptureScreenshot={onCaptureScreenshot}
          showScreenshot={showScreenshot}
        />

        <SettingsButton
          showText={false}
          variant="ghost"
          size="icon"
          className="shrink-0 rounded-control text-muted-foreground hover:bg-muted/55 hover:text-foreground"
          iconClassName="icon-sm"
        />

        <VoiceInputButton disabled={isLoading} />
      </div>

      <InputMetrics inputLength={inputLength} />
    </div>
  )
}
