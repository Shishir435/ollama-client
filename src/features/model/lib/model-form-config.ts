import type { TFunction } from "i18next"
import { Eye, Hash, Layers, type LucideIcon, Thermometer } from "lucide-react"
import type { NumberInputValidation } from "@/components/forms"

export type FormValues = {
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

export type NumberInputConfig = {
  name: keyof FormValues
  label: string
  focusId?: string
  icon?: LucideIcon
  min?: number
  max?: number
  step?: number
  validation?: NumberInputValidation
  group?: "sampling" | "context-row1" | "context-row2" | "context-row3"
  autoValue?: number
  autoLabel?: string
}

export type SliderConfig = {
  name: keyof FormValues
  label: string
  focusId?: string
  icon?: LucideIcon
  min: number
  max: number
  step?: number
  leftLabel?: string
  rightLabel?: string
}

/**
 * The one source of the numeric bounds. The inputs' validation messages and
 * the check that decides whether a value may be saved both read it, so a field
 * can never show as valid and be silently dropped (or the reverse).
 */
export const MODEL_FIELD_LIMITS = {
  top_k: { min: 1 },
  min_p: { min: 0, max: 1 },
  seed: { min: 0 },
  num_ctx: { min: 128 },
  num_predict: { min: -1 },
  repeat_penalty: { min: 0.1 },
  repeat_last_n: { min: -1 }
} as const

/** Above this window the KV cache alone can exhaust a typical GPU's memory. */
export const LARGE_NUM_CTX = 32768

type LimitedField = keyof typeof MODEL_FIELD_LIMITS

const withinLimits =
  (field: LimitedField) =>
  (v: FormValues[keyof FormValues]): boolean => {
    const limits: { min: number; max?: number } = MODEL_FIELD_LIMITS[field]
    return (
      typeof v === "number" &&
      !Number.isNaN(v) &&
      v >= limits.min &&
      (limits.max === undefined || v <= limits.max)
    )
  }

export const fieldValidations: Record<
  keyof FormValues,
  ((v: FormValues[keyof FormValues]) => boolean) | undefined
> = {
  system: undefined,
  temperature: undefined,
  top_k: withinLimits("top_k"),
  top_p: undefined,
  min_p: withinLimits("min_p"),
  seed: withinLimits("seed"),
  num_ctx: withinLimits("num_ctx"),
  num_predict: withinLimits("num_predict"),
  repeat_penalty: withinLimits("repeat_penalty"),
  repeat_last_n: withinLimits("repeat_last_n")
}

export const getSliderConfigs = (t: TFunction): SliderConfig[] => [
  {
    name: "temperature",
    focusId: "temperature",
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
    focusId: "top-p",
    label: t("settings.model.parameters.top_p.label"),
    icon: Eye,
    min: 0,
    max: 1,
    step: 0.01,
    leftLabel: t("settings.model.parameters.top_p.focused"),
    rightLabel: t("settings.model.parameters.top_p.diverse")
  }
]

export const getNumberInputConfigs = (t: TFunction): NumberInputConfig[] => [
  {
    name: "top_k",
    focusId: "top-k",
    label: t("settings.model.parameters.top_k.label"),
    icon: Hash,
    min: MODEL_FIELD_LIMITS.top_k.min,
    group: "sampling",
    validation: {
      min: {
        value: MODEL_FIELD_LIMITS.top_k.min,
        message: t("settings.model.parameters.top_k.validation_min", {
          min: MODEL_FIELD_LIMITS.top_k.min
        })
      }
    }
  },
  {
    name: "min_p",
    focusId: "min-p",
    label: t("settings.model.parameters.min_p.label"),
    icon: Layers,
    step: 0.01,
    min: MODEL_FIELD_LIMITS.min_p.min,
    max: MODEL_FIELD_LIMITS.min_p.max,
    group: "sampling",
    validation: {
      min: {
        value: MODEL_FIELD_LIMITS.min_p.min,
        message: t("settings.model.parameters.min_p.validation_min", {
          min: MODEL_FIELD_LIMITS.min_p.min
        })
      },
      max: {
        value: MODEL_FIELD_LIMITS.min_p.max,
        message: t("settings.model.parameters.min_p.validation_max", {
          max: MODEL_FIELD_LIMITS.min_p.max
        })
      }
    }
  },
  {
    name: "seed",
    focusId: "seed",
    label: t("settings.model.parameters.seed.label"),
    min: MODEL_FIELD_LIMITS.seed.min,
    group: "context-row1",
    validation: {
      min: {
        value: MODEL_FIELD_LIMITS.seed.min,
        message: t("settings.model.parameters.seed.validation_min", {
          min: MODEL_FIELD_LIMITS.seed.min
        })
      }
    }
  },
  {
    name: "num_ctx",
    focusId: "num-ctx",
    label: t("settings.model.parameters.num_ctx.label"),
    min: MODEL_FIELD_LIMITS.num_ctx.min,
    group: "context-row1",
    validation: {
      min: {
        value: MODEL_FIELD_LIMITS.num_ctx.min,
        message: t("settings.model.parameters.num_ctx.validation_min", {
          min: MODEL_FIELD_LIMITS.num_ctx.min
        })
      }
    }
  },
  {
    name: "num_predict",
    focusId: "num-predict",
    label: t("settings.model.parameters.num_predict.label"),
    autoValue: -1,
    autoLabel: t("settings.model.parameters.num_predict.auto"),
    group: "context-row2",
    validation: {
      min: {
        value: MODEL_FIELD_LIMITS.num_predict.min,
        message: t("settings.model.parameters.num_predict.validation_min", {
          min: MODEL_FIELD_LIMITS.num_predict.min
        })
      }
    }
  },
  {
    name: "repeat_penalty",
    focusId: "repeat-penalty",
    label: t("settings.model.parameters.repeat_penalty.label"),
    step: 0.1,
    min: MODEL_FIELD_LIMITS.repeat_penalty.min,
    group: "context-row2",
    validation: {
      min: {
        value: MODEL_FIELD_LIMITS.repeat_penalty.min,
        message: t("settings.model.parameters.repeat_penalty.validation_min", {
          min: MODEL_FIELD_LIMITS.repeat_penalty.min
        })
      }
    }
  },
  {
    name: "repeat_last_n",
    focusId: "repeat-last-n",
    label: t("settings.model.parameters.repeat_last_n.label"),
    min: MODEL_FIELD_LIMITS.repeat_last_n.min,
    group: "context-row3",
    validation: {
      min: {
        value: MODEL_FIELD_LIMITS.repeat_last_n.min,
        message: t("settings.model.parameters.repeat_last_n.validation_min", {
          min: MODEL_FIELD_LIMITS.repeat_last_n.min
        })
      }
    }
  }
]
