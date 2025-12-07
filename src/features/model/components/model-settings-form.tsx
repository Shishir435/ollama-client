import { useStorage } from "@plasmohq/storage/hook"
import { useEffect } from "react"
import { FormProvider, useForm } from "react-hook-form"
import { useTranslation } from "react-i18next"

import { SettingsCard } from "@/components/settings"
import { ThemeToggle } from "@/components/theme-toggle"
import { LoadedModelsInfo } from "@/features/model/components/loaded-models-info"
import { ModelInfo } from "@/features/model/components/model-info"
import { ModelMenu } from "@/features/model/components/model-menu"
import { ModelParametersSection } from "@/features/model/components/model-parameters-section"
import { ModelSystemSection } from "@/features/model/components/model-system-section"
import { BaseUrlSettings } from "@/features/model/components/ollama-base-url-settings"
import { OllamaStatusIndicator } from "@/features/model/components/ollama-status-indicator"
import { OllamaVersion } from "@/features/model/components/ollama-version"
import { useModelConfig } from "@/features/model/hooks/use-model-config"
import {
  type FormValues,
  fieldValidations
} from "@/features/model/lib/model-form-config"
import { useDebounce } from "@/hooks/use-debounce"
import { useSyncDebouncedValue } from "@/hooks/use-sync-debounced-value"
import { STORAGE_KEYS } from "@/lib/constants"
import { Settings } from "@/lib/lucide-icon"
import { plasmoGlobalStorage } from "@/lib/plasmo-global-storage"

export const ModelSettingsForm = () => {
  const { t } = useTranslation()
  const [selectedModel] = useStorage<string>(
    { key: STORAGE_KEYS.OLLAMA.SELECTED_MODEL, instance: plasmoGlobalStorage },
    ""
  )

  const [config, updateConfig] = useModelConfig(selectedModel)

  const methods = useForm<FormValues>({
    defaultValues: {
      system: config.system,
      temperature: config.temperature,
      top_k: config.top_k,
      top_p: config.top_p,
      min_p: config.min_p,
      seed: config.seed,
      num_ctx: config.num_ctx,
      num_predict: config.num_predict,
      repeat_penalty: config.repeat_penalty,
      repeat_last_n: config.repeat_last_n
    },
    mode: "onChange"
  })

  const watchedValues = methods.watch()

  // Debounce all form values
  const debouncedValues = {
    system: useDebounce(watchedValues.system, 500),
    temperature: useDebounce(watchedValues.temperature, 500),
    top_k: useDebounce(watchedValues.top_k, 500),
    top_p: useDebounce(watchedValues.top_p, 500),
    min_p: useDebounce(watchedValues.min_p, 500),
    seed: useDebounce(watchedValues.seed, 500),
    num_ctx: useDebounce(watchedValues.num_ctx, 500),
    num_predict: useDebounce(watchedValues.num_predict, 500),
    repeat_penalty: useDebounce(watchedValues.repeat_penalty, 500),
    repeat_last_n: useDebounce(watchedValues.repeat_last_n, 500)
  }

  // Sync form when config or model changes externally
  useEffect(() => {
    methods.reset({
      system: config.system,
      temperature: config.temperature,
      top_k: config.top_k,
      top_p: config.top_p,
      min_p: config.min_p,
      seed: config.seed,
      num_ctx: config.num_ctx,
      num_predict: config.num_predict,
      repeat_penalty: config.repeat_penalty,
      repeat_last_n: config.repeat_last_n
    } as FormValues)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config, methods.reset])

  // Sync debounced values to storage
  useSyncDebouncedValue(
    "system",
    debouncedValues.system,
    config.system,
    updateConfig
  )
  useSyncDebouncedValue(
    "temperature",
    debouncedValues.temperature,
    config.temperature,
    updateConfig
  )
  useSyncDebouncedValue(
    "top_k",
    debouncedValues.top_k,
    config.top_k,
    updateConfig,
    fieldValidations.top_k
  )
  useSyncDebouncedValue(
    "top_p",
    debouncedValues.top_p,
    config.top_p,
    updateConfig
  )
  useSyncDebouncedValue(
    "min_p",
    debouncedValues.min_p,
    config.min_p,
    updateConfig,
    fieldValidations.min_p
  )
  useSyncDebouncedValue(
    "seed",
    debouncedValues.seed,
    config.seed,
    updateConfig,
    fieldValidations.seed
  )
  useSyncDebouncedValue(
    "num_ctx",
    debouncedValues.num_ctx,
    config.num_ctx,
    updateConfig,
    fieldValidations.num_ctx
  )
  useSyncDebouncedValue(
    "num_predict",
    debouncedValues.num_predict,
    config.num_predict,
    updateConfig,
    fieldValidations.num_predict
  )
  useSyncDebouncedValue(
    "repeat_penalty",
    debouncedValues.repeat_penalty,
    config.repeat_penalty,
    updateConfig,
    fieldValidations.repeat_penalty
  )
  useSyncDebouncedValue(
    "repeat_last_n",
    debouncedValues.repeat_last_n,
    config.repeat_last_n,
    updateConfig,
    fieldValidations.repeat_last_n
  )

  if (!selectedModel) {
    return (
      <div className="mx-auto space-y-4">
        <SettingsCard
          icon={Settings}
          title={t("settings.model.configuration_title")}
          description={t("settings.model.configuration_description")}>
          <div className="space-y-4">
            <ModelMenu tooltipTextContent={t("settings.model.switch_model")} />
            <BaseUrlSettings />
          </div>
        </SettingsCard>
      </div>
    )
  }

  return (
    <FormProvider {...methods}>
      <div className="mx-auto space-y-4">
        <SettingsCard
          className="border-2 bg-gradient-to-r from-background to-muted/20"
          icon={Settings}
          title={t("settings.model.title")}
          description={t("settings.model.description")}
          headerActions={
            <>
              <ModelMenu
                tooltipTextContent={t("settings.model.switch_model")}
              />
              <ThemeToggle />
              <OllamaStatusIndicator />
              <OllamaVersion />
            </>
          }>
          <ModelInfo selectedModel={selectedModel} />
          <LoadedModelsInfo />
        </SettingsCard>
        <BaseUrlSettings />
        <ModelSystemSection config={config} updateConfig={updateConfig} />
        <ModelParametersSection />
      </div>
    </FormProvider>
  )
}
