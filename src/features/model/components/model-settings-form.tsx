import { useCallback, useEffect, useMemo, useRef } from "react"
import { FormProvider, useForm } from "react-hook-form"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"
import { SectionStack } from "@/components/layout"
import { SettingsCard, SettingsLevelGate } from "@/components/settings"
import { ThemeToggle } from "@/components/theme-toggle"
import { LoadedModelsInfo } from "@/features/model/components/loaded-models-info"
import { ModelInfo } from "@/features/model/components/model-info"
import { ModelMenu } from "@/features/model/components/model-menu"
import { ModelParametersSection } from "@/features/model/components/model-parameters-section"
import { ModelPerformanceSection } from "@/features/model/components/model-performance-section"
import { ModelSystemSection } from "@/features/model/components/model-system-section"
import { ProviderSettings } from "@/features/model/components/provider-settings"
import { ProviderStatusIndicator } from "@/features/model/components/provider-status-indicator"
import { ProviderVersion } from "@/features/model/components/provider-version"
import { useModelConfig } from "@/features/model/hooks/use-model-config"
import { useProviderModels } from "@/features/model/hooks/use-provider-models"
import {
  type FormValues,
  fieldValidations
} from "@/features/model/lib/model-form-config"
import { useDebounce } from "@/hooks/use-debounce"
import { DEFAULT_MODEL_CONFIG } from "@/lib/constants"
import { Settings } from "@/lib/lucide-icon"

const MODEL_CONFIG_FORM_KEYS: (keyof FormValues)[] = [
  "system",
  "temperature",
  "top_k",
  "top_p",
  "min_p",
  "seed",
  "num_ctx",
  "num_predict",
  "repeat_penalty",
  "repeat_last_n"
]

export const ModelSettingsForm = () => {
  const { t } = useTranslation()
  const { selectedModel, selectedProviderId } = useProviderModels()

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

  const formSyncedRef = useRef(false)

  // Sync form when config changes externally (storage loaded, model switched)
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
    formSyncedRef.current = true
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config, methods.reset])

  // Watch form fields for debounced auto-save
  const watchedSystem = methods.watch("system")
  const watchedTemperature = methods.watch("temperature")
  const watchedTopK = methods.watch("top_k")
  const watchedTopP = methods.watch("top_p")
  const watchedMinP = methods.watch("min_p")
  const watchedSeed = methods.watch("seed")
  const watchedNumCtx = methods.watch("num_ctx")
  const watchedNumPredict = methods.watch("num_predict")
  const watchedRepeatPenalty = methods.watch("repeat_penalty")
  const watchedRepeatLastN = methods.watch("repeat_last_n")

  const debouncedValues = useDebounce(
    useMemo(
      () => ({
        system: watchedSystem,
        temperature: watchedTemperature,
        top_k: watchedTopK,
        top_p: watchedTopP,
        min_p: watchedMinP,
        seed: watchedSeed,
        num_ctx: watchedNumCtx,
        num_predict: watchedNumPredict,
        repeat_penalty: watchedRepeatPenalty,
        repeat_last_n: watchedRepeatLastN
      }),
      [
        watchedSystem,
        watchedTemperature,
        watchedTopK,
        watchedTopP,
        watchedMinP,
        watchedSeed,
        watchedNumCtx,
        watchedNumPredict,
        watchedRepeatPenalty,
        watchedRepeatLastN
      ]
    ),
    500
  )

  const saveFormChanges = useCallback(
    ({ showToast = true }: { showToast?: boolean } = {}) => {
      if (!formSyncedRef.current) return

      const currentValues = methods.getValues()
      let hasChanges = false
      const updates: Partial<FormValues> = {}

      for (const key of MODEL_CONFIG_FORM_KEYS) {
        const formVal = currentValues[key]
        if (formVal === config[key as keyof typeof config]) continue

        const validation = fieldValidations[key]
        if (validation && !validation(formVal)) continue

        Object.assign(updates, { [key]: formVal })
        hasChanges = true
      }

      if (hasChanges) {
        updateConfig(updates as Partial<typeof config>)
        if (showToast) toast.success("Saved", { duration: 2000 })
      }
    },
    [config, updateConfig, methods]
  )

  // Save debounced form changes to storage
  useEffect(() => {
    // `debouncedValues` is the timing trigger; `saveFormChanges` reads
    // the latest form state via `methods.getValues()`.
    void debouncedValues
    saveFormChanges()
  }, [debouncedValues, saveFormChanges])

  // Flush unsaved edits when user switches settings tabs before debounce fires.
  useEffect(
    () => () => {
      saveFormChanges({ showToast: false })
    },
    [saveFormChanges]
  )

  const handleResetSystemPrompt = useCallback(() => {
    methods.setValue("system", DEFAULT_MODEL_CONFIG.system, {
      shouldDirty: true,
      shouldValidate: true
    })
    updateConfig({ system: DEFAULT_MODEL_CONFIG.system })
    toast.success("Saved", { duration: 2000 })
  }, [methods, updateConfig])

  if (!selectedModel) {
    return (
      <SectionStack>
        <SettingsCard
          icon={Settings}
          title={t("settings.model.configuration_title")}
          description={t("settings.model.configuration_description")}>
          <div className="space-y-4">
            <ModelMenu tooltipTextContent={t("settings.model.switch_model")} />
            <ProviderSettings />
          </div>
        </SettingsCard>
      </SectionStack>
    )
  }

  return (
    <FormProvider {...methods}>
      <SectionStack>
        <SettingsCard
          className="bg-card"
          icon={Settings}
          title={t("settings.model.title")}
          description={t("settings.model.description")}
          headerActions={
            <>
              <ModelMenu
                tooltipTextContent={t("settings.model.switch_model")}
              />
              <ThemeToggle />
              <ProviderStatusIndicator />
              <ProviderVersion />
            </>
          }>
          <ModelInfo
            selectedModel={selectedModel}
            selectedProviderId={selectedProviderId}
          />
          <LoadedModelsInfo />
        </SettingsCard>
        <ModelSystemSection
          config={config}
          updateConfig={updateConfig}
          onSave={saveFormChanges}
          onResetSystemPrompt={handleResetSystemPrompt}
        />
        <SettingsLevelGate settingId="keep-alive">
          <ModelPerformanceSection
            config={config}
            updateConfig={updateConfig}
          />
        </SettingsLevelGate>
        <SettingsLevelGate settingId="temperature">
          <ModelParametersSection />
        </SettingsLevelGate>
      </SectionStack>
    </FormProvider>
  )
}
