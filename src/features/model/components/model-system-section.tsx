import { useState } from "react"
import { useFormContext } from "react-hook-form"
import { useTranslation } from "react-i18next"
import { SettingsCard } from "@/components/settings"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Separator } from "@/components/ui/separator"
import { Textarea } from "@/components/ui/textarea"
import type { OllamaModelConfig } from "@/features/model/hooks/use-model-config"
import { MessageSquare, StopCircle } from "@/lib/lucide-icon"

interface ModelSystemSectionProps {
  config: OllamaModelConfig
  updateConfig: (updates: Partial<OllamaModelConfig>) => void
}

export const ModelSystemSection = ({
  config,
  updateConfig
}: ModelSystemSectionProps) => {
  const { t } = useTranslation()
  const { register } = useFormContext()
  const [newStop, setNewStop] = useState("")

  const handleAddStop = () => {
    const trimmed = newStop.trim()
    if (trimmed.length === 0 || config.stop.includes(trimmed)) return
    updateConfig({ stop: [...config.stop, trimmed] })
    setNewStop("")
  }

  const handleRemoveStop = (stopWord: string) => {
    updateConfig({ stop: config.stop.filter((s) => s !== stopWord) })
  }

  return (
    <SettingsCard
      icon={MessageSquare}
      title={t("settings.model.system.title")}
      description={t("settings.model.system.description")}
      contentClassName="space-y-6">
      <div className="space-y-3">
        <Label htmlFor="system" className="text-base font-medium">
          {t("settings.model.system.prompt_label")}
        </Label>
        <Textarea
          id="system"
          placeholder={t("settings.model.system.prompt_placeholder")}
          {...register("system")}
          className="min-h-[100px] resize-none"
        />
      </div>
      <Separator />
      <div className="space-y-3">
        <Label
          htmlFor="stop-sequences"
          className="flex items-center gap-2 text-base font-medium">
          <StopCircle className="h-4 w-4" />
          {t("settings.model.system.stop_sequences_label")}
        </Label>
        <div className="flex gap-2">
          <Input
            id="stop-sequences"
            value={newStop}
            placeholder={t("settings.model.system.stop_sequence_placeholder")}
            onChange={(e) => setNewStop(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleAddStop()}
            className="flex-1"
          />
          <Button type="button" onClick={handleAddStop}>
            {t("settings.model.system.add_button")}
          </Button>
        </div>
        {config.stop.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-2">
            {config.stop.map((word) => (
              <Badge
                key={word}
                variant="secondary"
                className="px-3 py-1 text-xs">
                {word}
                <button
                  type="button"
                  className="ml-2 text-muted-foreground transition-colors hover:text-destructive"
                  onClick={() => handleRemoveStop(word)}>
                  ×
                </button>
              </Badge>
            ))}
          </div>
        )}
      </div>
    </SettingsCard>
  )
}
