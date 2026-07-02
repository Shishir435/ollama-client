import { useCallback } from "react"
import { useTranslation } from "react-i18next"

import { TooltipActionButton } from "@/components/actions"
import { useSpeechRecognition } from "@/features/chat/hooks/use-speech-recognition"
import { chatInputStore } from "@/features/chat/stores/chat-input-store"
import { useToast } from "@/hooks/use-toast"
import { Mic, MicOff } from "@/lib/lucide-icon"
import { cn } from "@/lib/utils"

export interface VoiceInputButtonProps {
  disabled?: boolean
}

/**
 * Composer mic button: dictates speech into the input via the Web Speech API.
 * Renders nothing where recognition is unsupported (e.g. Firefox). Reading the
 * input from the store at transcript time avoids a stale-closure append.
 */
export const VoiceInputButton = ({ disabled }: VoiceInputButtonProps) => {
  const { t } = useTranslation()
  const { toast } = useToast()

  const handleTranscript = useCallback((text: string) => {
    const { input, setInput } = chatInputStore.getState()
    setInput(input.trim() ? `${input.trimEnd()} ${text}` : text)
  }, [])

  const handleError = useCallback(
    (code: string) => {
      const blocked = code === "not-allowed" || code === "service-not-allowed"
      toast({
        variant: "destructive",
        title: blocked
          ? t("chat.voice_input.mic_blocked_title")
          : t("chat.voice_input.error_title"),
        description: blocked
          ? t("chat.voice_input.mic_blocked_description")
          : t("chat.voice_input.error_description", { code })
      })
    },
    [t, toast]
  )

  const { supported, listening, toggle } = useSpeechRecognition(
    handleTranscript,
    handleError
  )

  if (!supported) return null

  const label = listening
    ? t("chat.voice_input.stop")
    : t("chat.voice_input.start")

  return (
    <TooltipActionButton
      type="button"
      variant="ghost"
      size="icon"
      className={cn(
        "shrink-0 rounded-control text-muted-foreground hover:bg-muted/55 hover:text-foreground",
        listening && "text-destructive hover:text-destructive"
      )}
      onClick={toggle}
      disabled={disabled}
      label={label}
      aria-pressed={listening}
      icon={
        listening ? (
          <MicOff className="icon-sm" aria-hidden="true" />
        ) : (
          <Mic className="icon-sm" aria-hidden="true" />
        )
      }
    />
  )
}
