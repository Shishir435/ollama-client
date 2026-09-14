import { Brain, ChevronDown, RotateCcw } from "lucide-react"
import { useTranslation } from "react-i18next"
import { TooltipActionButton } from "@/components/actions/tooltip-action-button"
import { Button } from "@/components/ui/button"
import {
  Popover,
  PopoverContent,
  PopoverTrigger
} from "@/components/ui/popover"
import { Slider } from "@/components/ui/slider"
import { useModelConfig } from "@/features/model/hooks/use-model-config"
import { useProviderModels } from "@/features/model/hooks/use-provider-models"
import { DEFAULT_PROVIDER_ID } from "@/lib/constants"
import type { ReasoningEffort, ReasoningEffortSupport } from "@/types/model"
import {
  getReasoningEffortScale,
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
    <ReasoningEffortControl
      modelName={selectedModel}
      providerId={selectedProviderId}
      support={support}
    />
  )
}

/**
 * The levels a model offers are a scale, not an unordered list, so the control
 * is a slider over them rather than a menu: a step up or down is one drag or
 * one arrow key, and the whole range is visible while choosing. `auto` is the
 * first stop and the one the reset returns to, because leaving the level to
 * the provider is this setting's default rather than a value like the others.
 */
const ReasoningEffortControl = ({
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
  const scale = getReasoningEffortScale(support)
  const value: ReasoningEffort = isReasoningEffortAllowed(
    config.reasoning_effort,
    support
  )
    ? config.reasoning_effort
    : "auto"
  const index = Math.max(scale.indexOf(value), 0)
  const label = t(`settings.model.parameters.reasoning_effort.options.${value}`)
  const triggerLabel =
    value === "auto"
      ? t("settings.model.parameters.reasoning_effort.options.auto_short")
      : label
  const controlLabel = t("settings.model.parameters.reasoning_effort.label")

  const select = (effort: ReasoningEffort | undefined) => {
    if (effort && effort !== value) updateConfig({ reasoning_effort: effort })
  }
  const selectStop = (next: number) =>
    select(scale[Math.min(Math.max(next, 0), scale.length - 1)])

  return (
    <Popover>
      <PopoverTrigger
        render={
          <Button
            variant="ghost"
            role="combobox"
            aria-label={controlLabel}
            title={`${controlLabel}: ${triggerLabel}`}
            className="h-8 w-24 shrink-0 justify-between gap-1 rounded-panel px-2 font-medium"
          />
        }>
        <Brain className="icon-sm shrink-0 text-muted-foreground" />
        <span className="min-w-0 truncate">{triggerLabel}</span>
        <ChevronDown className="icon-sm shrink-0 text-muted-foreground" />
      </PopoverTrigger>
      <PopoverContent
        side="top"
        align="center"
        sideOffset={6}
        className="w-60 gap-3 p-3">
        <div className="flex items-start gap-2">
          <Brain className="icon-sm mt-0.5 shrink-0 text-muted-foreground" />
          <div className="min-w-0 flex-1 text-center">
            <p
              title={modelName}
              className="truncate text-micro text-muted-foreground">
              {modelName}
            </p>
            <p className="truncate font-medium text-primary">{label}</p>
          </div>
          <TooltipActionButton
            variant="ghost"
            size="icon-xs"
            icon={RotateCcw}
            iconClassName="icon-xs"
            labelKey="settings.model.parameters.reasoning_effort.reset"
            disabled={value === "auto"}
            /**
             * The default is a value on the scale, not a position on it: the
             * stops are ordered by how hard the model thinks, and off sits
             * below auto rather than beside it.
             */
            onClick={() => select("auto")}
          />
        </div>
        <Slider
          size="lg"
          value={[index]}
          min={0}
          max={scale.length - 1}
          step={1}
          marks={scale.map((effort) =>
            t(`settings.model.parameters.reasoning_effort.options.${effort}`)
          )}
          onValueChange={(next) =>
            selectStop(Array.isArray(next) ? (next[0] ?? 0) : next)
          }
          thumbProps={{
            getAriaLabel: () => controlLabel,
            getAriaValueText: (_formatted, current) =>
              t(
                `settings.model.parameters.reasoning_effort.options.${scale[current] ?? "auto"}`
              )
          }}
        />
      </PopoverContent>
    </Popover>
  )
}
