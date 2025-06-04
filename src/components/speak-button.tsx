import { Mic, MicOff } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger
} from "@/components/ui/tooltip"
import { useSpeechSynthesis } from "@/hooks/use-speech-synthesis"

interface SpeakButtonProps {
  text: string
}

export function SpeakButton({ text }: SpeakButtonProps) {
  const { speaking, toggle } = useSpeechSynthesis()

  if (!text.trim()) return null

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          size="sm"
          variant="link"
          className="h-6 px-2"
          aria-label={speaking ? "Stop speaking" : "Speak message"}
          title={speaking ? "Stop speaking" : "Speak message"}
          onClick={() => toggle(text)}
          type="button">
          {speaking ? (
            <MicOff size={16} className="text-destructive" />
          ) : (
            <Mic size={16} />
          )}
        </Button>
      </TooltipTrigger>
      <TooltipContent>
        {speaking ? "Stop speaking" : "Speak message"}
      </TooltipContent>
    </Tooltip>
  )
}
