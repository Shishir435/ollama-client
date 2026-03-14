import { useEffect, useMemo, useState } from "react"
import { useTranslation } from "react-i18next"
import {
  SettingsCard,
  SettingsFormField,
  SettingsSwitch
} from "@/components/settings"
import { Input } from "@/components/ui/input"
import type { ProviderModelConfig } from "@/features/model/hooks/use-model-config"
import { useDebounce } from "@/hooks/use-debounce"
import { Zap } from "@/lib/lucide-icon"

interface ModelPerformanceSectionProps {
  config: ProviderModelConfig
  updateConfig: (updates: Partial<ProviderModelConfig>) => void
}

const parseKeepAlive = (value: string): string | number | undefined => {
  const trimmed = value.trim()
  if (!trimmed) return undefined
  if (/^\d+$/.test(trimmed)) return Number.parseInt(trimmed, 10)
  return trimmed
}

const stringifyKeepAlive = (value?: string | number) =>
  value === undefined || value === null ? "" : String(value)

export const ModelPerformanceSection = ({
  config,
  updateConfig
}: ModelPerformanceSectionProps) => {
  const { t } = useTranslation()
  const [keepAliveInput, setKeepAliveInput] = useState(
    stringifyKeepAlive(config.keep_alive)
  )
  const debouncedKeepAlive = useDebounce(keepAliveInput, 500)

  useEffect(() => {
    setKeepAliveInput(stringifyKeepAlive(config.keep_alive))
  }, [config.keep_alive])

  useEffect(() => {
    const parsed = parseKeepAlive(debouncedKeepAlive)
    if (parsed !== config.keep_alive) {
      updateConfig({ keep_alive: parsed })
    }
  }, [debouncedKeepAlive, config.keep_alive, updateConfig])



  return (
    <SettingsCard
      icon={Zap}
      title={t("settings.model.runtime.title")}
      description={t("settings.model.runtime.description")}
      contentClassName="space-y-5">
      <SettingsFormField
        htmlFor="keep-alive"
        label={t("settings.model.runtime.keep_alive_label")}
        description={t("settings.model.runtime.keep_alive_description")}>
        <Input
          id="keep-alive"
          value={keepAliveInput}
          onChange={(e) => setKeepAliveInput(e.target.value)}
          placeholder={t("settings.model.runtime.keep_alive_placeholder")}
        />
      </SettingsFormField>


      <div className="grid gap-4 sm:grid-cols-2">
        <SettingsSwitch
          label={t("settings.model.runtime.warm_on_select_label")}
          description={t("settings.model.runtime.warm_on_select_description")}
          checked={config.warm_on_select ?? false}
          onCheckedChange={(checked) =>
            updateConfig({ warm_on_select: checked })
          }
        />
        <SettingsSwitch
          label={t("settings.model.runtime.unload_on_switch_label")}
          description={t("settings.model.runtime.unload_on_switch_description")}
          checked={config.unload_on_switch ?? false}
          onCheckedChange={(checked) =>
            updateConfig({ unload_on_switch: checked })
          }
        />
      </div>
    </SettingsCard>
  )
}
