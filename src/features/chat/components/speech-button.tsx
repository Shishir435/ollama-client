import { useTranslation } from "react-i18next"

import { TooltipActionButton } from "@/components/actions"
import { useSpeechSynthesis } from "@/features/chat/hooks/use-speech-synthesis"
import { chatIconBtnCls } from "@/features/chat/lib/chat-styles"
import { Mic, MicOff } from "@/lib/lucide-icon"

export interface SpeakButtonProps {
  text: string
}

export const SpeechButton = ({ text }: SpeakButtonProps) => {
  const { t } = useTranslation()
  const { speakingText, toggle, isLoadingVoices } = useSpeechSynthesis()
  const speaking = speakingText === text

  if (!text.trim()) return null

  const getLabel = () => {
    if (isLoadingVoices) return t("chat.speech.loading_voices")
    if (speaking) return t("chat.speech.stop_speaking")
    return t("chat.speech.speak_message")
  }

  return (
    <TooltipActionButton
      size="icon"
      variant="ghost"
      className={chatIconBtnCls}
      label={getLabel()}
      title={getLabel()}
      onClick={() => !isLoadingVoices && toggle(text)}
      disabled={isLoadingVoices}
      type="button"
      icon={
        speaking ? (
          <MicOff className="icon-xs text-destructive" />
        ) : (
          <Mic className="icon-xs" />
        )
      }
    />
  )
}
