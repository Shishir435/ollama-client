import { useEffect, useRef, useState } from "react"

export const useVoices = () => {
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const voicesLoadedRef = useRef(false)
  const timeoutRef = useRef<NodeJS.Timeout | null>(null)

  useEffect(() => {
    const loadVoices = () => {
      const availableVoices = window.speechSynthesis.getVoices()

      if (availableVoices.length > 0) {
        setVoices((prevVoices) => {
          const currentVoiceURIs = prevVoices
            .map((v) => v.voiceURI)
            .sort()
            .join(",")
          const newVoiceURIs = availableVoices
            .map((v) => v.voiceURI)
            .sort()
            .join(",")

          if (currentVoiceURIs !== newVoiceURIs || !voicesLoadedRef.current) {
            voicesLoadedRef.current = true
            setIsLoading(false)
            return [...availableVoices]
          }
          return prevVoices
        })
      }
    }

    loadVoices()

    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current)
    }

    timeoutRef.current = setTimeout(() => {
      loadVoices()
    }, 100)

    const handleVoicesChanged = () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current)
      }
      loadVoices()
    }

    window.speechSynthesis.addEventListener(
      "voiceschanged",
      handleVoicesChanged
    )

    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current)
      }
      window.speechSynthesis.removeEventListener(
        "voiceschanged",
        handleVoicesChanged
      )
    }
  }, [])

  return { voices, isLoading }
}
