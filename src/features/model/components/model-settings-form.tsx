import { Check, Settings, TriangleAlert } from "lucide-react"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { FormProvider, useForm, useWatch } from "react-hook-form"
import { useTranslation } from "react-i18next"
import { StatusCallout } from "@/components/feedback"
import { SectionStack } from "@/components/layout"
import { SettingsCard } from "@/components/settings"
import { SettingsLevelGate } from "@/components/settings/settings-disclosure"
import { CustomInstructionsCard } from "@/features/model/components/custom-instructions-card"
import { LoadedModelsInfo } from "@/features/model/components/loaded-models-info"
import { McpServersCard } from "@/features/model/components/mcp-servers-card"
import { ModelInfo } from "@/features/model/components/model-info"
import { ModelMenu } from "@/features/model/components/model-menu"
import { ModelParametersCard } from "@/features/model/components/model-parameters-card"
import { ModelPerformanceCard } from "@/features/model/components/model-performance-card"
import { ModelSystemCard } from "@/features/model/components/model-system-card"
import { ProviderStatusIndicator } from "@/features/model/components/provider-status-indicator"
import { ProviderVersion } from "@/features/model/components/provider-version"
import { useModelConfig } from "@/features/model/hooks/use-model-config"
import { useProviderModels } from "@/features/model/hooks/use-provider-models"
import {
  type FormValues,
  fieldValidations,
  LARGE_NUM_CTX
} from "@/features/model/lib/model-form-config"
import { useDebounce } from "@/hooks/use-debounce"
import { DEFAULT_MODEL_CONFIG } from "@/lib/constants"

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

/**
 * Model parameters are written automatically, 500 ms after typing stops. That
 * is the one deliberate exception to the explicit-save rule on this page, and
 * it is only acceptable because the outcome is always visible: an inline status
 * says "Saved" only when every edited value was written, and names the fields
 * it refused otherwise. Values outside their bounds are never written.
 */
type ParameterSaveStatus =
  | { kind: "idle" }
  | { kind: "saved" }
  | { kind: "rejected"; fields: (keyof FormValues)[] }

export const ModelSettingsForm = () => {
  const { t } = useTranslation()
  const { models = [], selectedModel, selectedProviderId } = useProviderModels()

  const [config, updateConfig] = useModelConfig(
    selectedModel,
    selectedProviderId
  )
  const selectedModelInfo = models.find(
    (model) =>
      model.model === selectedModel && model.providerId === selectedProviderId
  )

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
  const { control, reset } = methods

  const formSyncedRef = useRef(false)
  const [saveStatus, setSaveStatus] = useState<ParameterSaveStatus>({
    kind: "idle"
  })

  // Sync form when config changes externally (storage loaded, model switched)
  useEffect(() => {
    reset({
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
  }, [config, reset])

  // Watch form fields for debounced auto-save
  const watchedSystem = useWatch({ control, name: "system" })
  const watchedTemperature = useWatch({ control, name: "temperature" })
  const watchedTopK = useWatch({ control, name: "top_k" })
  const watchedTopP = useWatch({ control, name: "top_p" })
  const watchedMinP = useWatch({ control, name: "min_p" })
  const watchedSeed = useWatch({ control, name: "seed" })
  const watchedNumCtx = useWatch({ control, name: "num_ctx" })
  const watchedNumPredict = useWatch({ control, name: "num_predict" })
  const watchedRepeatPenalty = useWatch({ control, name: "repeat_penalty" })
  const watchedRepeatLastN = useWatch({ control, name: "repeat_last_n" })

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
    ({ announce = true }: { announce?: boolean } = {}) => {
      if (!formSyncedRef.current) return

      const currentValues = methods.getValues()
      const updates: Partial<FormValues> = {}
      const rejected: (keyof FormValues)[] = []

      for (const key of MODEL_CONFIG_FORM_KEYS) {
        const formVal = currentValues[key]
        if (formVal === config[key as keyof typeof config]) continue

        const validation = fieldValidations[key]
        if (validation && !validation(formVal)) {
          rejected.push(key)
          continue
        }

        Object.assign(updates, { [key]: formVal })
      }

      const wrote = Object.keys(updates).length > 0
      if (wrote) updateConfig(updates as Partial<typeof config>)
      if (!announce) return
      /*
       * Reporting the outcome of a write to external storage, not deriving
       * state: deferred so the debounce effect that calls this does not
       * cascade a render of its own.
       */
      if (rejected.length > 0) {
        queueMicrotask(() =>
          setSaveStatus({ kind: "rejected", fields: rejected })
        )
      } else if (wrote) {
        queueMicrotask(() => setSaveStatus({ kind: "saved" }))
      }
    },
    [config, updateConfig, methods]
  )

  // Save debounced form changes to storage
  useEffect(() => {
    /**
     * `debouncedValues` is the timing trigger; `saveFormChanges` reads
     * the latest form state via `methods.getValues()`.
     */
    void debouncedValues
    saveFormChanges()
  }, [debouncedValues, saveFormChanges])

  // Flush unsaved edits when user switches settings tabs before debounce fires.
  useEffect(
    () => () => {
      saveFormChanges({ announce: false })
    },
    [saveFormChanges]
  )

  const handleResetSystemPrompt = useCallback(() => {
    methods.setValue("system", DEFAULT_MODEL_CONFIG.system, {
      shouldDirty: true,
      shouldValidate: true
    })
    updateConfig({ system: DEFAULT_MODEL_CONFIG.system })
    setSaveStatus({ kind: "saved" })
  }, [methods, updateConfig])

  if (!selectedModel) {
    return (
      <SectionStack>
        <SettingsCard
          icon={Settings}
          title={t("settings.model.configuration_title")}
          description={t("settings.model.configuration_description")}>
          <ModelMenu tooltipTextContent={t("settings.model.switch_model")} />
        </SettingsCard>
        <CustomInstructionsCard />
        <McpServersCard />
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
          description={t("settings.model.description", {
            model: selectedModel
          })}
          headerActions={
            <>
              <ModelMenu
                tooltipTextContent={t("settings.model.switch_model")}
              />
              <ProviderStatusIndicator />
              <ProviderVersion />
            </>
          }>
          <div className="divide-y divide-border">
            <ModelInfo
              selectedModel={selectedModel}
              selectedProviderId={selectedProviderId}
            />
            <LoadedModelsInfo />
          </div>
        </SettingsCard>
        <ParameterSaveNotice status={saveStatus} />
        <ModelSystemCard
          config={config}
          updateConfig={updateConfig}
          onSave={saveFormChanges}
          onResetSystemPrompt={handleResetSystemPrompt}
        />
        <CustomInstructionsCard />
        <McpServersCard />
        <SettingsLevelGate settingId="keep-alive">
          <ModelPerformanceCard config={config} updateConfig={updateConfig} />
        </SettingsLevelGate>
        <SettingsLevelGate settingId="temperature">
          <ModelParametersCard
            reasoningEffort={config.reasoning_effort}
            reasoningSupport={selectedModelInfo?.capabilityHints?.reasoning}
            onReasoningEffortChange={(reasoning_effort) =>
              updateConfig({ reasoning_effort })
            }
          />
        </SettingsLevelGate>
        {Number(watchedNumCtx) > LARGE_NUM_CTX && (
          <StatusCallout
            variant="warning"
            icon={TriangleAlert}
            title={t("settings.model.parameters.num_ctx.vram_warning_title")}
            description={t("settings.model.parameters.num_ctx.vram_warning")}
          />
        )}
      </SectionStack>
    </FormProvider>
  )
}

const ParameterSaveNotice = ({ status }: { status: ParameterSaveStatus }) => {
  const { t } = useTranslation()
  if (status.kind === "idle") return null
  return (
    <output
      aria-live="polite"
      className="flex items-center justify-end gap-2 text-xs text-muted-foreground">
      {status.kind === "saved" ? (
        <>
          <Check className="icon-sm text-status-success-text" />
          {t("settings.model.parameters.autosave_saved")}
        </>
      ) : (
        <>
          <TriangleAlert className="icon-sm text-status-warning-text" />
          {t("settings.model.parameters.autosave_rejected", {
            fields: status.fields
              .map((field) => t(`settings.model.parameters.${field}.label`))
              .join(", ")
          })}
        </>
      )}
    </output>
  )
}
