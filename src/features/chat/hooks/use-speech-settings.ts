import { useSetting } from "@/hooks/use-setting"
import { SETTINGS } from "@/lib/storage/settings"

export const useSpeechSettings = () => {
  const [rate, setRate] = useSetting(SETTINGS.TTS_RATE)
  const [pitch, setPitch] = useSetting(SETTINGS.TTS_PITCH)
  const [voiceURI, setVoiceURI] = useSetting(SETTINGS.TTS_VOICE_URI)

  return { rate, setRate, pitch, setPitch, voiceURI, setVoiceURI }
}
