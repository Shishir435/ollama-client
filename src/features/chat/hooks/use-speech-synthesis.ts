import { useCallback, useEffect, useState } from "react"
import { useSpeechSettings } from "@/features/chat/hooks/use-speech-settings"
import { useVoices } from "@/features/chat/hooks/use-voice"
import { markdownToSpeechText } from "@/lib/utils"

export const useSpeechSynthesis = () => {
  const [speaking, setSpeaking] = useState(false)
  const [isLoadingVoices, setIsLoadingVoices] = useState(true)
  const voices = useVoices()
  const { rate, pitch, voiceURI } = useSpeechSettings()
  useEffect(() => {
    if (voices.length > 0 && isLoadingVoices) {
      setIsLoadingVoices(false)
    }
  }, [voices, isLoadingVoices])

  useEffect(() => {
    const handleEnd = () => setSpeaking(false)
    const handleError = () => setSpeaking(false)

    window.speechSynthesis.addEventListener("end", handleEnd)
    window.speechSynthesis.addEventListener("error", handleError)

    return () => {
      window.speechSynthesis.removeEventListener("end", handleEnd)
      window.speechSynthesis.removeEventListener("error", handleError)
      window.speechSynthesis.cancel()
    }
  }, [])

  const speak = useCallback(
    (markdownText: string) => {
      if (!markdownText || speaking || isLoadingVoices) return

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

      utterance.onstart = () => setSpeaking(true)
      utterance.onend = () => setSpeaking(false)
      utterance.onerror = () => setSpeaking(false)

      window.speechSynthesis.speak(utterance)
    },
    [speaking, rate, pitch, voiceURI, voices, isLoadingVoices]
  )

  const stop = useCallback(() => {
    if (window.speechSynthesis.speaking) {
      window.speechSynthesis.cancel()
      setSpeaking(false)
    }
  }, [])

  const toggle = useCallback(
    (text: string) => {
      if (speaking) {
        stop()
      } else {
        speak(text)
      }
    },
    [speaking, speak, stop]
  )

  return { speaking, speak, stop, toggle, isLoadingVoices, voices }
}
