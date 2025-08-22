import { STORAGE_KEYS } from "@/lib/constants"
import { plasmoGlobalStorage } from "@/lib/plasmo-global-storage"

import { useStorage } from "@plasmohq/storage/hook"

export function useSpeechSettings() {
  const [rate, setRate] = useStorage<number>(
    { key: STORAGE_KEYS.TTS.RATE, instance: plasmoGlobalStorage },
    1
  )

  const [pitch, setPitch] = useStorage<number>(
    { key: STORAGE_KEYS.TTS.PITCH, instance: plasmoGlobalStorage },
    1
  )

  const [voiceURI, setVoiceURI] = useStorage<string>(
    { key: STORAGE_KEYS.TTS.VOICE_URI, instance: plasmoGlobalStorage },
    ""
  )

  return { rate, setRate, pitch, setPitch, voiceURI, setVoiceURI }
}
