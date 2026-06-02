import { useCallback, useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import { FormGrid } from "@/components/layout"
import {
  SettingsCard,
  SettingsField,
  SettingsSwitch
} from "@/components/settings"
import { Input } from "@/components/ui/input"
import type { ProviderModelConfig } from "@/features/model/hooks/use-model-config"
import { useDebounce } from "@/hooks/use-debounce"
import { Zap } from "@/lib/lucide-icon"

export interface ModelPerformanceSectionProps {
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

  const saveKeepAlive = useCallback(
    (value: string) => {
      const parsed = parseKeepAlive(value)
      if (parsed !== config.keep_alive) {
        updateConfig({ keep_alive: parsed })
      }
    },
    [config.keep_alive, updateConfig]
  )

  useEffect(() => {
    setKeepAliveInput(stringifyKeepAlive(config.keep_alive))
  }, [config.keep_alive])

  useEffect(() => {
    saveKeepAlive(debouncedKeepAlive)
  }, [debouncedKeepAlive, saveKeepAlive])

  useEffect(
    () => () => {
      saveKeepAlive(keepAliveInput)
    },
    [keepAliveInput, saveKeepAlive]
  )

  return (
    <SettingsCard
      icon={Zap}
      title={t("settings.model.runtime.title")}
      description={t("settings.model.runtime.description")}
      contentClassName="space-y-5">
      <SettingsField
        htmlFor="keep-alive"
        label={t("settings.model.runtime.keep_alive_label")}
        description={t("settings.model.runtime.keep_alive_description")}>
        <Input
          id="keep-alive"
          value={keepAliveInput}
          onChange={(e) => setKeepAliveInput(e.target.value)}
          onBlur={() => saveKeepAlive(keepAliveInput)}
          placeholder={t("settings.model.runtime.keep_alive_placeholder")}
        />
      </SettingsField>

      <FormGrid>
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
      </FormGrid>
    </SettingsCard>
  )
}
