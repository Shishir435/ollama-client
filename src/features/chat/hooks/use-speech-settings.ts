import { useStorage } from "@plasmohq/storage/hook"
import { STORAGE_KEYS } from "@/lib/constants"
import {
  getPlasmoStorageForKey,
  plasmoGlobalStorage
} from "@/lib/plasmo-global-storage"

export const useSpeechSettings = () => {
  const [rate, setRate] = useStorage<number>(
    { key: STORAGE_KEYS.TTS.RATE, instance: plasmoGlobalStorage },
    1
  )

  const [pitch, setPitch] = useStorage<number>(
    { key: STORAGE_KEYS.TTS.PITCH, instance: plasmoGlobalStorage },
    1
  )

  const [voiceURI, setVoiceURI] = useStorage<string>(
    {
      key: STORAGE_KEYS.TTS.VOICE_URI,
      instance: getPlasmoStorageForKey(STORAGE_KEYS.TTS.VOICE_URI)
    },
    ""
  )

  return { rate, setRate, pitch, setPitch, voiceURI, setVoiceURI }
}
