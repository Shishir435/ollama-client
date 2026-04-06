import { useCallback, useEffect } from "react"
import { useSpeechSettings } from "@/features/chat/hooks/use-speech-settings"
import { useVoices } from "@/features/chat/hooks/use-voice"
import { useSpeechStore } from "@/features/chat/stores/speech-store"
import { markdownToSpeechText } from "@/lib/utils"

export const useSpeechSynthesis = () => {
  const { speakingText, setSpeakingText } = useSpeechStore()
  const { voices, isLoading: isLoadingVoices } = useVoices()
  const { rate, pitch, voiceURI } = useSpeechSettings()

  useEffect(() => {
    return () => {
      window.speechSynthesis.cancel()
    }
  }, [])

  const speak = useCallback(
    (markdownText: string) => {
      if (!markdownText || speakingText || isLoadingVoices) return

      if (window.speechSynthesis.speaking) {
        window.speechSynthesis.cancel()
      }

      const cleanText = markdownToSpeechText(markdownText)
      const utterance = new SpeechSynthesisUtterance(cleanText)

      utterance.rate = rate
      utterance.pitch = pitch
      utterance.lang = navigator.language

      const matchedVoice = voices.find((v) => v.voiceURI === voiceURI)
      if (matchedVoice) {
        utterance.voice = matchedVoice
      }

      utterance.onstart = () => setSpeakingText(markdownText)
      utterance.onend = () => setSpeakingText(null)
      utterance.onerror = () => setSpeakingText(null)

      window.speechSynthesis.speak(utterance)
    },
    [
      speakingText,
      rate,
      pitch,
      voiceURI,
      voices,
      isLoadingVoices,
      setSpeakingText
    ]
  )

  const stop = useCallback(() => {
    if (window.speechSynthesis.speaking) {
      window.speechSynthesis.cancel()
      setSpeakingText(null)
    }
  }, [setSpeakingText])

  const toggle = useCallback(
    (text: string) => {
      if (speakingText === text) {
        stop()
      } else {
        speak(text)
      }
    },
    [speakingText, speak, stop]
  )

  return { speakingText, speak, stop, toggle, isLoadingVoices, voices }
}
