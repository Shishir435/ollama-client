import { useState } from "react"
import { useTranslation } from "react-i18next"
import { ControlledTextarea } from "@/components/forms"
import {
  SettingsActionRow,
  SettingsCard,
  SettingsFormField
} from "@/components/settings"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Separator } from "@/components/ui/separator"
import type { ProviderModelConfig } from "@/features/model/hooks/use-model-config"
import { MessageSquare, RotateCcw, StopCircle } from "@/lib/lucide-icon"

export interface ModelSystemSectionProps {
  config: ProviderModelConfig
  updateConfig: (updates: Partial<ProviderModelConfig>) => void
  onSave: () => void
  onResetSystemPrompt: () => void
}

export const ModelSystemSection = ({
  config,
  updateConfig,
  onSave,
  onResetSystemPrompt
}: ModelSystemSectionProps) => {
  const { t } = useTranslation()
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
      <SettingsFormField
        htmlFor="system"
        label={t("settings.model.system.prompt_label")}
        className="space-y-3">
        <ControlledTextarea
          id="system"
          name="system"
          placeholder={t("settings.model.system.prompt_placeholder")}
          onBlur={onSave}
          className="min-h-25 resize-none"
        />
        <SettingsActionRow>
          <Button type="button" variant="ghost" onClick={onResetSystemPrompt}>
            <RotateCcw className="mr-0.5 icon-xs" />
            {t("settings.prompts.reset")}
          </Button>
        </SettingsActionRow>
      </SettingsFormField>
      <Separator />
      <SettingsFormField
        htmlFor="stop-sequences"
        label={
          <div className="flex items-center gap-2">
            <StopCircle className="icon-md" />
            <span>{t("settings.model.system.stop_sequences_label")}</span>
          </div>
        }
        className="space-y-3">
        <SettingsActionRow>
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
        </SettingsActionRow>
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
      </SettingsFormField>
    </SettingsCard>
  )
}
