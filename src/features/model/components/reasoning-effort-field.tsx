import { useEffect, useMemo } from "react"
import { useTranslation } from "react-i18next"
import { SettingsSelectField } from "@/components/settings"
import { SelectItem } from "@/components/ui/select"
import type { ReasoningEffort, ReasoningEffortSupport } from "@/types/model"

export const isReasoningEffortAllowed = (
  value: ReasoningEffort,
  support: ReasoningEffortSupport
): boolean =>
  value === "auto" ||
  (value === "enabled" && support.canEnable) ||
  (value === "none" && support.canDisable && !support.mandatory) ||
  support.supportedEfforts.includes(
    value as (typeof support.supportedEfforts)[number]
  )

export const getReasoningEffortOptions = (
  support?: ReasoningEffortSupport
): ReasoningEffort[] => {
  if (!support) return ["auto"]
  return [
    "auto",
    ...(support.canEnable && support.supportedEfforts.length === 0
      ? (["enabled"] as const)
      : []),
    ...(support.canDisable && !support.mandatory ? (["none"] as const) : []),
    ...support.supportedEfforts
  ]
}

/**
 * The options a model offers, ordered as a scale from "leave it to the
 * provider" up to its hardest setting, which is the order a slider needs and
 * the order the list reads in anyway. `enabled` is last because it only ever
 * appears for a model with no levels of its own, where the scale is auto, off,
 * on.
 */
const REASONING_EFFORT_SCALE: ReasoningEffort[] = [
  "auto",
  "none",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
  "enabled"
]

export const getReasoningEffortScale = (
  support?: ReasoningEffortSupport
): ReasoningEffort[] => {
  const options = getReasoningEffortOptions(support)
  return REASONING_EFFORT_SCALE.filter((effort) => options.includes(effort))
}

export const ReasoningEffortField = ({
  value,
  support,
  onChange
}: {
  value: ReasoningEffort
  support?: ReasoningEffortSupport
  onChange: (value: ReasoningEffort) => void
}) => {
  const { t } = useTranslation()
  const options = useMemo(() => getReasoningEffortOptions(support), [support])

  useEffect(() => {
    if (support && !isReasoningEffortAllowed(value, support)) onChange("auto")
  }, [onChange, support, value])

  const displayedValue =
    support && isReasoningEffortAllowed(value, support) ? value : "auto"
  const description = support
    ? support.source === "model-metadata"
      ? t("settings.model.parameters.reasoning_effort.description_reported")
      : t("settings.model.parameters.reasoning_effort.description_profile")
    : t("settings.model.parameters.reasoning_effort.description_unknown")

  return (
    <SettingsSelectField
      id="reasoning-effort"
      focusId="reasoning-effort"
      label={t("settings.model.parameters.reasoning_effort.label")}
      description={description}
      value={displayedValue}
      onValueChange={(next) => onChange(next as ReasoningEffort)}
      disabled={!support}
      triggerClassName="w-full">
      {options.map((option) => (
        <SelectItem key={option} value={option}>
          {t(`settings.model.parameters.reasoning_effort.options.${option}`)}
        </SelectItem>
      ))}
    </SettingsSelectField>
  )
}
