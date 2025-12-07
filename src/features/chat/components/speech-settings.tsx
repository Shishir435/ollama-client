import { useEffect, useMemo, useState } from "react"
import { useTranslation } from "react-i18next"

import { SettingsCard } from "@/components/settings"
import { Badge } from "@/components/ui/badge"
import { Label } from "@/components/ui/label"
import { Slider } from "@/components/ui/slider"
import { Textarea } from "@/components/ui/textarea"
import { VoiceSelector } from "@/features/chat/components/voice-selector"
import { useSpeechSettings } from "@/features/chat/hooks/use-speech-settings"
import { useVoices } from "@/features/chat/hooks/use-voice"
import { Mic, Settings, Volume2 } from "@/lib/lucide-icon"

const getRateDescription = (rate: number, t: (key: string) => string) => {
  if (rate < 0.8) return t("settings.speech.rate.very_slow")
  if (rate < 1.0) return t("settings.speech.rate.slow")
  if (rate === 1.0) return t("settings.speech.rate.normal")
  if (rate < 1.3) return t("settings.speech.rate.fast")
  return t("settings.speech.rate.very_fast")
}

const getPitchDescription = (pitch: number, t: (key: string) => string) => {
  if (pitch < 0.8) return t("settings.speech.pitch.very_low")
  if (pitch < 1.0) return t("settings.speech.pitch.low")
  if (pitch === 1.0) return t("settings.speech.pitch.normal")
  if (pitch < 1.3) return t("settings.speech.pitch.high")
  return t("settings.speech.pitch.very_high")
}

export const SpeechSettings = () => {
  const { t } = useTranslation()
  const { voices, isLoading: isLoadingVoices } = useVoices()
  const { rate, setRate, pitch, setPitch, voiceURI, setVoiceURI } =
    useSpeechSettings()
  const [testText, setTestText] = useState("")

  const selectedVoice = useMemo(
    () => voices.find((v) => v.voiceURI === voiceURI),
    [voices, voiceURI]
  )

  useEffect(() => {
    if (!isLoadingVoices && voices.length > 0) {
      if (!voiceURI) {
        const defaultVoice = voices.find((v) => v.default) ?? voices[0]
        if (defaultVoice) {
          setVoiceURI(defaultVoice.voiceURI)
        }
      } else {
        const voiceExists = voices.some((v) => v.voiceURI === voiceURI)
        if (!voiceExists) {
          const defaultVoice = voices.find((v) => v.default) ?? voices[0]
          if (defaultVoice) {
            setVoiceURI(defaultVoice.voiceURI)
          }
        }
      }
    }
  }, [voices, voiceURI, setVoiceURI, isLoadingVoices])

  return (
    <div className="mx-auto space-y-4">
      <SettingsCard
        icon={Volume2}
        title={t("settings.speech.title")}
        description={t("settings.speech.description")}
        contentClassName="space-y-5">
        {/* Voice Selection */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Mic className="h-4 w-4 text-muted-foreground" />
              <Label htmlFor="voice-select" className="text-sm font-medium">
                {t("settings.speech.voice_label")}
              </Label>
            </div>
            {selectedVoice && (
              <Badge variant="outline" className="text-xs">
                {selectedVoice.lang}
              </Badge>
            )}
          </div>
          <VoiceSelector
            voices={voices}
            selectedVoiceURI={voiceURI || null}
            onVoiceChange={setVoiceURI}
            isLoading={isLoadingVoices}
          />
        </div>

        {/* Rate Control */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <Label htmlFor="rate-slider" className="text-sm font-medium">
              {t("settings.speech.rate_label")}
            </Label>
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="font-mono text-xs">
                {rate.toFixed(1)}x
              </Badge>
              <span className="text-xs text-muted-foreground">
                {getRateDescription(rate, t)}
              </span>
            </div>
          </div>
          <div className="px-1">
            <Slider
              id="rate-slider"
              min={0.5}
              max={2}
              step={0.1}
              value={[rate]}
              onValueChange={([val]) => setRate(val)}
              className="w-full"
            />
            <div className="mt-1 flex justify-between text-xs text-muted-foreground">
              <span>0.5x</span>
              <span>1.0x</span>
              <span>2.0x</span>
            </div>
          </div>
        </div>

        {/* Pitch Control */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <Label htmlFor="pitch-slider" className="text-sm font-medium">
              {t("settings.speech.pitch_label")}
            </Label>
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="font-mono text-xs">
                {pitch.toFixed(1)}
              </Badge>
              <span className="text-xs text-muted-foreground">
                {getPitchDescription(pitch, t)}
              </span>
            </div>
          </div>
          <div className="px-1">
            <Slider
              id="pitch-slider"
              min={0}
              max={2}
              step={0.1}
              value={[pitch]}
              onValueChange={([val]) => setPitch(val)}
              className="w-full"
            />
            <div className="mt-1 flex justify-between text-xs text-muted-foreground">
              <span>0.0</span>
              <span>1.0</span>
              <span>2.0</span>
            </div>
          </div>
        </div>

        <div className="border-t pt-4">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Settings className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm font-medium">
                {t("settings.speech.preview_title")}
              </span>
            </div>
          </div>
          <div className="space-y-3">
            <Label htmlFor="test-text" className="text-sm font-medium">
              {t("settings.speech.test_text_label")}
            </Label>
            <Textarea
              id="test-text"
              placeholder={t("settings.speech.test_text_placeholder")}
              value={testText}
              onChange={(e) => setTestText(e.target.value)}
              rows={3}
              className="resize-none"
            />
            <div className="flex items-center justify-between">
              <p className="text-xs text-muted-foreground">
                {testText.trim()
                  ? t("settings.speech.test_hint_text")
                  : t("settings.speech.test_hint_default")}
              </p>
              <button
                type="button"
                className="rounded-md bg-secondary px-3 py-1 text-xs transition-colors hover:bg-secondary/80"
                onClick={() => {
                  if ("speechSynthesis" in window) {
                    // Cancel any ongoing speech
                    window.speechSynthesis.cancel()

                    const textToSpeak =
                      testText.trim() || t("settings.speech.test_fallback")
                    const utterance = new SpeechSynthesisUtterance(textToSpeak)
                    utterance.rate = rate
                    utterance.pitch = pitch

                    // Use the selected voice if available
                    if (selectedVoice) {
                      // Get fresh voice reference from speechSynthesis API
                      // This ensures compatibility across browsers
                      const freshVoice = window.speechSynthesis
                        .getVoices()
                        .find((v) => v.voiceURI === selectedVoice.voiceURI)
                      if (freshVoice) {
                        utterance.voice = freshVoice
                      }
                    }

                    window.speechSynthesis.speak(utterance)
                  }
                }}>
                {t("settings.speech.test_button")}
              </button>
            </div>
          </div>
        </div>
      </SettingsCard>
    </div>
  )
}
