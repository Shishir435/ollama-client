import { Mic, MicOff } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger
} from "@/components/ui/tooltip"
import { useSpeechSynthesis } from "@/features/chat/hooks/use-speech-synthesis"

interface SpeakButtonProps {
  text: string
}

export const SpeechButton = ({ text }: SpeakButtonProps) => {
  const { speaking, toggle, isLoadingVoices } = useSpeechSynthesis()

  if (!text.trim()) return null

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          size="sm"
          variant="link"
          className="h-6 px-2"
          aria-label={
            isLoadingVoices
              ? "Loading voices..."
              : speaking
                ? "Stop speaking"
                : "Speak message"
          }
          title={
            isLoadingVoices
              ? "Loading voices..."
              : speaking
                ? "Stop speaking"
                : "Speak message"
          }
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
      <TooltipContent>
        {isLoadingVoices
          ? "Loading voices..."
          : speaking
            ? "Stop speaking"
            : "Speak message"}
      </TooltipContent>
    </Tooltip>
  )
}
