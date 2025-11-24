import { useStorage } from "@plasmohq/storage/hook"
import { useEffect, useState } from "react"
import { FormProvider, useForm } from "react-hook-form"
import { ThemeToggle } from "@/components/theme-toggle"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Separator } from "@/components/ui/separator"
import { Textarea } from "@/components/ui/textarea"
import type { NumberInputValidation } from "@/features/model/components/form-number-input"
import { FormNumberInput } from "@/features/model/components/form-number-input"
import { FormSectionCard } from "@/features/model/components/form-section-card"
import { FormSlider } from "@/features/model/components/form-slider"
import { LoadedModelsInfo } from "@/features/model/components/loaded-models-info"
import { ModelInfo } from "@/features/model/components/model-info"
import { ModelMenu } from "@/features/model/components/model-menu"
import { BaseUrlSettings } from "@/features/model/components/ollama-base-url-settings"
import { OllamaStatusIndicator } from "@/features/model/components/ollama-status-indicator"
import { OllamaVersion } from "@/features/model/components/ollama-version"
import { useModelConfig } from "@/features/model/hooks/use-model-config"
import { useDebounce } from "@/hooks/use-debounce"
import { useSyncDebouncedValue } from "@/hooks/use-sync-debounced-value"
import { STORAGE_KEYS } from "@/lib/constants"
import type { LucideIcon } from "@/lib/lucide-icon"
import {
  Brain,
  Eye,
  Hash,
  Layers,
  MessageSquare,
  Settings,
  StopCircle,
  Target,
  Thermometer
} from "@/lib/lucide-icon"
import { plasmoGlobalStorage } from "@/lib/plasmo-global-storage"

type FormValues = {
  system: string
  temperature: number
  top_k: number
  top_p: number
  min_p: number
  seed: number
  num_ctx: number
  num_predict: number
  repeat_penalty: number
  repeat_last_n: number
}

type NumberInputConfig = {
  name: keyof FormValues
  label: string
  icon?: LucideIcon
  min?: number
  max?: number
  step?: number
  validation?: NumberInputValidation
  group?: "sampling" | "context-row1" | "context-row2" | "context-row3"
}

type SliderConfig = {
  name: keyof FormValues
  label: string
  icon?: LucideIcon
  min: number
  max: number
  step?: number
  leftLabel?: string
  rightLabel?: string
}

import { useTranslation } from "react-i18next"

// Field configurations for validation
const fieldValidations: Record<
  keyof FormValues,
  ((v: FormValues[keyof FormValues]) => boolean) | undefined
> = {
  system: undefined,
  temperature: undefined,
  top_k: (v) => typeof v === "number" && !Number.isNaN(v) && v >= 1,
  top_p: undefined,
  min_p: (v) => typeof v === "number" && !Number.isNaN(v) && v >= 0 && v <= 1,
  seed: (v) => typeof v === "number" && !Number.isNaN(v) && v >= 0,
  num_ctx: (v) => typeof v === "number" && !Number.isNaN(v) && v >= 128,
  num_predict: (v) => typeof v === "number" && !Number.isNaN(v) && v >= -1,
  repeat_penalty: (v) => typeof v === "number" && !Number.isNaN(v) && v > 0,
  repeat_last_n: (v) => typeof v === "number" && !Number.isNaN(v) && v >= -1
}

export const ModelSettingsForm = () => {
  const { t } = useTranslation()
  const [selectedModel] = useStorage<string>(
    { key: STORAGE_KEYS.OLLAMA.SELECTED_MODEL, instance: plasmoGlobalStorage },
    ""
  )

  const [config, updateConfig] = useModelConfig(selectedModel)
  const [newStop, setNewStop] = useState("")

  // Slider field configurations
  const sliderConfigs: SliderConfig[] = [
    {
      name: "temperature",
      label: t("settings.model.parameters.temperature.label"),
      icon: Thermometer,
      min: 0,
      max: 1,
      step: 0.01,
      leftLabel: t("settings.model.parameters.temperature.conservative"),
      rightLabel: t("settings.model.parameters.temperature.creative")
    },
    {
      name: "top_p",
      label: t("settings.model.parameters.top_p.label"),
      icon: Eye,
      min: 0,
      max: 1,
      step: 0.01,
      leftLabel: t("settings.model.parameters.top_p.focused"),
      rightLabel: t("settings.model.parameters.top_p.diverse")
    }
  ]

  // Number input field configurations
  const numberInputConfigs: NumberInputConfig[] = [
    {
      name: "top_k",
      label: t("settings.model.parameters.top_k.label"),
      icon: Hash,
      min: 1,
      group: "sampling",
      validation: {
        min: {
          value: 1,
          message: t("settings.model.parameters.top_k.validation_min", {
            min: 1
          })
        }
      }
    },
    {
      name: "min_p",
      label: t("settings.model.parameters.min_p.label"),
      icon: Layers,
      step: 0.01,
      min: 0.0,
      max: 1.0,
      group: "sampling",
      validation: {
        min: {
          value: 0,
          message: t("settings.model.parameters.min_p.validation_min", {
            min: 0
          })
        },
        max: {
          value: 1,
          message: t("settings.model.parameters.min_p.validation_max", {
            max: 1
          })
        }
      }
    },
    {
      name: "seed",
      label: t("settings.model.parameters.seed.label"),
      min: 0,
      group: "context-row1",
      validation: {
        min: {
          value: 0,
          message: t("settings.model.parameters.seed.validation_min", {
            min: 0
          })
        }
      }
    },
    {
      name: "num_ctx",
      label: t("settings.model.parameters.num_ctx.label"),
      min: 128,
      group: "context-row1",
      validation: {
        min: {
          value: 128,
          message: t("settings.model.parameters.num_ctx.validation_min", {
            min: 128
          })
        }
      }
    },
    {
      name: "num_predict",
      label: t("settings.model.parameters.num_predict.label"),
      group: "context-row2",
      validation: {
        min: {
          value: -1,
          message: t("settings.model.parameters.num_predict.validation_min", {
            min: -1
          })
        }
      }
    },
    {
      name: "repeat_penalty",
      label: t("settings.model.parameters.repeat_penalty.label"),
      step: 0.1,
      min: 0.1,
      group: "context-row2",
      validation: {
        min: {
          value: 0.1,
          message: t(
            "settings.model.parameters.repeat_penalty.validation_min",
            {
              min: 0.1
            }
          )
        }
      }
    },
    {
      name: "repeat_last_n",
      label: t("settings.model.parameters.repeat_last_n.label"),
      min: -1,
      group: "context-row3",
      validation: {
        min: {
          value: -1,
          message: t("settings.model.parameters.repeat_last_n.validation_min", {
            min: -1
          })
        }
      }
    }
  ]

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
        <Card>
          <CardHeader>
            <div className="mb-2 flex items-center gap-2">
              <Settings className="h-5 w-5 text-muted-foreground" />
              <CardTitle className="text-2xl">
                {t("settings.model.configuration_title")}
              </CardTitle>
            </div>
            <CardDescription>
              {t("settings.model.configuration_description")}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <ModelMenu tooltipTextContent={t("settings.model.switch_model")} />
            <BaseUrlSettings />
          </CardContent>
        </Card>
      </div>
    )
  }

  const handleAddStop = () => {
    const trimmed = newStop.trim()
    if (trimmed.length === 0 || config.stop.includes(trimmed)) return
    updateConfig({ stop: [...config.stop, trimmed] })
    setNewStop("")
  }

  const handleRemoveStop = (stopWord: string) => {
    updateConfig({ stop: config.stop.filter((s) => s !== stopWord) })
  }

  // Group number inputs by layout using config (static arrays, no memoization needed)
  const samplingNumberInputs = numberInputConfigs.filter(
    (f) => f.group === "sampling"
  )
  const contextNumberInputsRow1 = numberInputConfigs.filter(
    (f) => f.group === "context-row1"
  )
  const contextNumberInputsRow2 = numberInputConfigs.filter(
    (f) => f.group === "context-row2"
  )
  const contextNumberInputsRow3 = numberInputConfigs.filter(
    (f) => f.group === "context-row3"
  )

  return (
    <FormProvider {...methods}>
      <div className="mx-auto space-y-4">
        <Card className="border-2 bg-gradient-to-r from-background to-muted/20">
          <CardHeader>
            <div className="flex items-center justify-between">
              <div className="mb-2 flex items-center gap-2">
                <Settings className="h-5 w-5 text-muted-foreground" />
                <CardTitle className="text-xl">
                  {t("settings.model.title")}
                </CardTitle>
              </div>
              <div className="flex items-center gap-3">
                <ModelMenu
                  tooltipTextContent={t("settings.model.switch_model")}
                />
                <ThemeToggle />
                <OllamaStatusIndicator />
                <OllamaVersion />
              </div>
            </div>
            <CardDescription>{t("settings.model.description")}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <ModelInfo selectedModel={selectedModel} />
            <LoadedModelsInfo />
          </CardContent>
        </Card>

        <BaseUrlSettings />

        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <MessageSquare className="h-5 w-5 text-muted-foreground" />
              <CardTitle className="text-xl">
                {t("settings.model.system.title")}
              </CardTitle>
            </div>
            <CardDescription>
              {t("settings.model.system.description")}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="space-y-3">
              <Label htmlFor="system" className="text-base font-medium">
                {t("settings.model.system.prompt_label")}
              </Label>
              <Textarea
                id="system"
                placeholder={t("settings.model.system.prompt_placeholder")}
                {...methods.register("system")}
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
                  placeholder={t(
                    "settings.model.system.stop_sequence_placeholder"
                  )}
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
          </CardContent>
        </Card>

        <div className="grid gap-6 lg:grid-cols-2">
          <FormSectionCard
            title={t("settings.model.sampling.title")}
            description={t("settings.model.sampling.description")}
            icon={Target}>
            <div className="space-y-6">
              {sliderConfigs.map((slider) => (
                <FormSlider key={slider.name} {...slider} />
              ))}
              <div className="grid grid-cols-2 gap-4">
                {samplingNumberInputs.map((input) => (
                  <FormNumberInput key={input.name} {...input} />
                ))}
              </div>
            </div>
          </FormSectionCard>

          <FormSectionCard
            title={t("settings.model.context.title")}
            description={t("settings.model.context.description")}
            icon={Brain}>
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                {contextNumberInputsRow1.map((input) => (
                  <FormNumberInput key={input.name} {...input} />
                ))}
              </div>
              <div className="grid grid-cols-2 gap-4">
                {contextNumberInputsRow2.map((input) => (
                  <FormNumberInput key={input.name} {...input} />
                ))}
              </div>
              {contextNumberInputsRow3.map((input) => (
                <FormNumberInput key={input.name} {...input} />
              ))}
            </div>
          </FormSectionCard>
        </div>
      </div>
    </FormProvider>
  )
}
