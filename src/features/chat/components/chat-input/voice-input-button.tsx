import { useCallback, useRef } from "react"
import { useTranslation } from "react-i18next"

import { TooltipActionButton } from "@/components/actions"
import { useSpeechRecognition } from "@/features/chat/hooks/use-speech-recognition"
import { chatInputStore } from "@/features/chat/stores/chat-input-store"
import { useToast } from "@/hooks/use-toast"
import { browser } from "@/lib/browser-api"
import { logger } from "@/lib/logger"
import { Mic } from "@/lib/lucide-icon"
import { cn } from "@/lib/utils"

export interface VoiceInputButtonProps {
  disabled?: boolean
}

const joinDictation = (base: string, spoken: string): string => {
  if (!spoken) return base
  return base.trim() ? `${base.trimEnd()} ${spoken}` : spoken
}

/**
 * Composer mic button: chat-app-style dictation via the Web Speech API.
 * While listening, interim results stream into the input live; the session
 * ends on mic toggle, a keypress, or a silence pause (see the hook). Renders
 * nothing where recognition can't work (Firefox, Brave).
 */
export const VoiceInputButton = ({ disabled }: VoiceInputButtonProps) => {
  const { t } = useTranslation()
  const { toast } = useToast()
  // Composer text as it was when dictation started; spoken text is appended
  // to this snapshot on every live update rather than to the moving input.
  const baseInputRef = useRef("")

  const handleLiveTranscript = useCallback(
    (finalText: string, interimText: string) => {
      const spoken = [finalText, interimText].filter(Boolean).join(" ")
      chatInputStore
        .getState()
        .setInput(joinDictation(baseInputRef.current, spoken))
    },
    []
  )

  const handleFinalTranscript = useCallback((text: string) => {
    // Drop any dangling interim hypothesis; keep only committed speech.
    chatInputStore
      .getState()
      .setInput(joinDictation(baseInputRef.current, text))
  }, [])

  const handleError = useCallback(
    (code: string) => {
      const blocked = code === "not-allowed" || code === "service-not-allowed"
      if (blocked) {
        // The sidepanel can't reliably show the mic permission prompt — open
        // the dedicated handshake page in a tab, where the prompt always
        // shows and the grant covers the whole extension origin.
        browser.tabs
          .create({ url: browser.runtime.getURL("/mic-permission.html") })
          .catch((error: unknown) => {
            logger.error(
              "Failed to open mic permission page",
              "VoiceInputButton",
              { error }
            )
            toast({
              variant: "destructive",
              title: t("chat.voice_input.mic_blocked_title"),
              description: t("chat.voice_input.mic_blocked_description")
            })
          })
        return
      }
      toast({
        variant: "destructive",
        title: t("chat.voice_input.error_title"),
        description: t("chat.voice_input.error_description", { code })
      })
    },
    [t, toast]
  )

  const handleNotice = useCallback(
    (code: string) => {
      if (code === "local-model-downloading") {
        toast({
          title: t("chat.voice_input.local_downloading_title"),
          description: t("chat.voice_input.local_downloading_description")
        })
      }
    },
    [t, toast]
  )

  const { supported, listening, toggle } = useSpeechRecognition({
    onLiveTranscript: handleLiveTranscript,
    onFinalTranscript: handleFinalTranscript,
    onError: handleError,
    onNotice: handleNotice
  })

  if (!supported) return null

  const label = listening
    ? t("chat.voice_input.stop")
    : t("chat.voice_input.start")

  const handleClick = () => {
    if (!listening) {
      baseInputRef.current = chatInputStore.getState().input
    }
    toggle()
  }

  return (
    <TooltipActionButton
      type="button"
      variant="ghost"
      size="icon"
      className={cn(
        "shrink-0 rounded-control text-muted-foreground hover:bg-muted/55 hover:text-foreground",
        listening &&
          "bg-destructive/10 text-destructive hover:bg-destructive/15 hover:text-destructive"
      )}
      onClick={handleClick}
      disabled={disabled}
      label={label}
      aria-pressed={listening}
      icon={
        listening ? (
          <span className="relative flex items-center justify-center">
            <span
              aria-hidden="true"
              className="absolute inline-flex size-full animate-ping rounded-full bg-destructive/40"
            />
            <Mic className="icon-sm relative" aria-hidden="true" />
          </span>
        ) : (
          <Mic className="icon-sm" aria-hidden="true" />
        )
      }
    />
  )
}
