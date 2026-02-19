import { useEffect, useMemo, useState } from "react"
import { useTranslation } from "react-i18next"
import { SettingsCard, SettingsFormField, SettingsSwitch } from "@/components/settings"
import { Input } from "@/components/ui/input"
import { useDebounce } from "@/hooks/use-debounce"
import type { ProviderModelConfig } from "@/features/model/hooks/use-model-config"
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

  const runtimeInputs = useMemo(
    () => [
      {
        key: "num_thread" as const,
        label: t("settings.model.runtime.num_thread_label"),
        value: config.num_thread ?? ""
      },
      {
        key: "num_gpu" as const,
        label: t("settings.model.runtime.num_gpu_label"),
        value: config.num_gpu ?? ""
      },
      {
        key: "num_batch" as const,
        label: t("settings.model.runtime.num_batch_label"),
        value: config.num_batch ?? ""
      }
    ],
    [
      config.num_batch,
      config.num_gpu,
      config.num_thread,
      t
    ]
  )

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

      <div className="grid gap-4 sm:grid-cols-3">
        {runtimeInputs.map((input) => (
          <SettingsFormField
            key={input.key}
            htmlFor={input.key}
            label={input.label}>
            <Input
              id={input.key}
              type="number"
              min={0}
              value={input.value}
              onChange={(e) => {
                const raw = e.target.value
                if (raw === "") {
                  updateConfig({ [input.key]: undefined })
                  return
                }
                const parsed = Number.parseInt(raw, 10)
                if (!Number.isNaN(parsed) && parsed >= 0) {
                  updateConfig({ [input.key]: parsed })
                }
              }}
            />
          </SettingsFormField>
        ))}
      </div>

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
