import type { TFunction } from "i18next"
import type { NumberInputValidation } from "@/features/model/components/form-number-input"
import type { LucideIcon } from "@/lib/lucide-icon"
import { Eye, Hash, Layers, Thermometer } from "@/lib/lucide-icon"

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
  icon?: LucideIcon
  min?: number
  max?: number
  step?: number
  validation?: NumberInputValidation
  group?: "sampling" | "context-row1" | "context-row2" | "context-row3"
}

export type SliderConfig = {
  name: keyof FormValues
  label: string
  icon?: LucideIcon
  min: number
  max: number
  step?: number
  leftLabel?: string
  rightLabel?: string
}

export const fieldValidations: Record<
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

export const getSliderConfigs = (t: TFunction): SliderConfig[] => [
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

export const getNumberInputConfigs = (t: TFunction): NumberInputConfig[] => [
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
        message: t("settings.model.parameters.repeat_penalty.validation_min", {
          min: 0.1
        })
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
