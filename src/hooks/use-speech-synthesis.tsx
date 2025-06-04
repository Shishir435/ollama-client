import { useCallback, useEffect, useState } from "react"

export function useSpeechSynthesis() {
  const [speaking, setSpeaking] = useState(false)

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
    (text: string) => {
      if (!text || speaking) return

      if (window.speechSynthesis.speaking) {
        window.speechSynthesis.cancel()
      }

      const utterance = new SpeechSynthesisUtterance(text)
      // TODO: set voice, lang, pitch, rate here
      // TODO: utterance.lang = navigator.language

      utterance.onstart = () => setSpeaking(true)
      utterance.onend = () => setSpeaking(false)
      utterance.onerror = () => setSpeaking(false)

      window.speechSynthesis.speak(utterance)
    },
    [speaking]
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

  return { speaking, speak, stop, toggle }
}
