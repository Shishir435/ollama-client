import type { TFunction } from "i18next"
import type { ModelPullStatus } from "@/features/model/hooks/use-model-pull"

/** A small chat model for a first pull; any name from the library also works. */
export const SUGGESTED_FIRST_MODEL = "llama3.2"

/** The user-facing line for one pull phase, through the existing copy. */
export const pullProgressLabel = (
  t: TFunction,
  progress: ModelPullStatus | null
): string | null => {
  if (!progress) return null
  switch (progress.phase) {
    case "starting":
      return t("settings.model_management.starting")
    case "pulling":
      return progress.percent === undefined
        ? t("settings.model_management.pulling_text", {
            text: progress.text ?? ""
          })
        : t("settings.model_management.pulling_percent", {
            percent: progress.percent,
            text: progress.text ?? ""
          })
    case "success":
      return t("settings.model_management.success")
    case "cancelled":
      return t("settings.model_management.cancelled")
    case "failed":
      return progress.error
        ? t("settings.model_management.failed_with_reason", {
            reason: progress.error
          })
        : t("settings.model_management.failed")
  }
}

/** The terminal command that does the same pull, for when the inline one fails. */
export const ollamaPullCommand = (model: string): string =>
  `ollama pull ${model.trim() || SUGGESTED_FIRST_MODEL}`
