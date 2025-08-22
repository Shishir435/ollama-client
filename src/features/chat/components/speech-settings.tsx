import { useEffect } from "react"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select"
import { Slider } from "@/components/ui/slider"
import { useSpeechSettings } from "@/features/chat/hooks/use-speech-settings"
import { useVoices } from "@/features/chat/hooks/use-voice"

export const SpeechSettings = () => {
  const voices = useVoices()
  const { rate, setRate, pitch, setPitch, voiceURI, setVoiceURI } =
    useSpeechSettings()

  // If stored voiceURI is not available in voices
  // (e.g., first load or voice removed), fallback to default
  useEffect(() => {
    if (!voiceURI && voices.length > 0) {
      const defaultVoice = voices.find((v) => v.default) ?? voices[0]
      if (defaultVoice) {
        setVoiceURI(defaultVoice.voiceURI)
      }
    } else if (
      voiceURI &&
      voices.length > 0 &&
      !voices.find((v) => v.voiceURI === voiceURI)
    ) {
      // Stored voiceURI not found in current voices - reset to default
      const defaultVoice = voices.find((v) => v.default) ?? voices[0]
      if (defaultVoice) {
        setVoiceURI(defaultVoice.voiceURI)
      }
    }
  }, [voices, voiceURI, setVoiceURI])

  return (
    <Card className="mx-auto space-y-4">
      <CardHeader>
        <CardTitle>Speech Settings</CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        <div>
          <Label htmlFor="voice-select">Voice</Label>
          <Select
            value={voiceURI}
            onValueChange={setVoiceURI}
            aria-label="Select speech synthesis voice">
            <SelectTrigger>
              <SelectValue placeholder="Select a voice" />
            </SelectTrigger>
            <SelectContent>
              {voices.map((voice) => (
                <SelectItem key={voice.voiceURI} value={voice.voiceURI}>
                  {voice.name} ({voice.lang}) {voice.default ? "(default)" : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div>
          <Label htmlFor="rate-slider">Rate: {rate.toFixed(2)}</Label>
          <Slider
            id="rate-slider"
            min={0.5}
            max={2}
            step={0.1}
            value={[rate]}
            onValueChange={([val]) => setRate(val)}
          />
        </div>

        <div>
          <Label htmlFor="pitch-slider">Pitch: {pitch.toFixed(2)}</Label>
          <Slider
            id="pitch-slider"
            min={0}
            max={2}
            step={0.1}
            value={[pitch]}
            onValueChange={([val]) => setPitch(val)}
          />
        </div>
      </CardContent>
    </Card>
  )
}
