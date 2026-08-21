import { Brain } from "lucide-react"
import { useTranslation } from "react-i18next"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select"
import { useModelConfig } from "@/features/model/hooks/use-model-config"
import { useProviderModels } from "@/features/model/hooks/use-provider-models"
import { DEFAULT_PROVIDER_ID } from "@/lib/constants"
import type { ReasoningEffortSupport } from "@/types/model"
import {
  getReasoningEffortOptions,
  isReasoningEffortAllowed
} from "./reasoning-effort-field"

/**
 * Composer-level model trait control. Keeping this next to the model picker
 * lets that picker close after a model change without hiding the new model's
 * reasoning options behind a second trip through the catalog.
 */
export const ReasoningEffortMenu = () => {
  const { models, selectedModel, selectedModelRef } = useProviderModels()
  const selectedProviderId =
    selectedModelRef?.providerId ||
    models.find((model) => model.name === selectedModel)?.providerId ||
    DEFAULT_PROVIDER_ID
  const selectedModelData = models.find(
    (model) =>
      model.name === selectedModel &&
      (model.providerId || DEFAULT_PROVIDER_ID) === selectedProviderId
  )
  const support = selectedModelData?.capabilityHints?.reasoning

  if (!selectedModel || !support) return null

  return (
    <ReasoningEffortSelect
      modelName={selectedModel}
      providerId={selectedProviderId}
      support={support}
    />
  )
}

const ReasoningEffortSelect = ({
  modelName,
  providerId,
  support
}: {
  modelName: string
  providerId: string
  support: ReasoningEffortSupport
}) => {
  const { t } = useTranslation()
  const [config, updateConfig] = useModelConfig(modelName, providerId)
  const options = getReasoningEffortOptions(support)
  const value = isReasoningEffortAllowed(config.reasoning_effort, support)
    ? config.reasoning_effort
    : "auto"
  const label =
    value === "auto"
      ? t("settings.model.parameters.reasoning_effort.options.auto_short")
      : t(`settings.model.parameters.reasoning_effort.options.${value}`)

  return (
    <Select
      value={value}
      onValueChange={(next) =>
        updateConfig({ reasoning_effort: next as typeof value })
      }>
      <SelectTrigger
        size="sm"
        aria-label={t("settings.model.parameters.reasoning_effort.label")}
        title={`${t("settings.model.parameters.reasoning_effort.label")}: ${label}`}
        className="h-8 max-w-20 shrink-0 gap-1 overflow-hidden border-0 bg-transparent px-2 hover:bg-muted/55">
        <Brain className="icon-sm shrink-0 text-muted-foreground" />
        <SelectValue className="min-w-0 truncate">{label}</SelectValue>
      </SelectTrigger>
      <SelectContent
        side="top"
        align="start"
        alignItemWithTrigger={false}
        className="w-44 min-w-0">
        {options.map((option) => (
          <SelectItem key={option} value={option}>
            {t(`settings.model.parameters.reasoning_effort.options.${option}`)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
