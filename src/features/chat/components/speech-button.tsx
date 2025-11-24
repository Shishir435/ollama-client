import { useTranslation } from "react-i18next"

import { Button } from "@/components/ui/button"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger
} from "@/components/ui/tooltip"
import { useSpeechSynthesis } from "@/features/chat/hooks/use-speech-synthesis"
import { Mic, MicOff } from "@/lib/lucide-icon"

interface SpeakButtonProps {
  text: string
}

export const SpeechButton = ({ text }: SpeakButtonProps) => {
  const { t } = useTranslation()
  const { speaking, toggle, isLoadingVoices } = useSpeechSynthesis()

  if (!text.trim()) return null

  const getLabel = () => {
    if (isLoadingVoices) return t("chat.speech.loading_voices")
    if (speaking) return t("chat.speech.stop_speaking")
    return t("chat.speech.speak_message")
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          size="sm"
          variant="link"
          className="h-6 px-2"
          aria-label={getLabel()}
          title={getLabel()}
          onClick={() => !isLoadingVoices && toggle(text)}
          disabled={isLoadingVoices}
          type="button">
          {speaking ? (
            <MicOff size={16} className="text-destructive" />
          ) : (
            <Mic size={16} />
          )}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{getLabel()}</TooltipContent>
    </Tooltip>
  )
}
