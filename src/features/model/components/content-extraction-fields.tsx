import type React from "react"
import { useTranslation } from "react-i18next"
import {
  SettingsFormField,
  SettingsSelectField,
  SettingsSliderField
} from "@/components/settings"
import { Input } from "@/components/ui/input"
import { SelectItem } from "@/components/ui/select"
import {
  SCROLL_STRATEGY_OPTIONS,
  SCROLL_STRATEGY_OPTIONS_SHORT
} from "@/lib/constants-ui"
import type { ScrollStrategy } from "@/types"
import type { TIMEOUT_FIELDS } from "./content-extraction-constants"

type TimeoutField = (typeof TIMEOUT_FIELDS)[number]

interface TimeoutInputFieldProps {
  field: TimeoutField
  value: number
  onValueChange: (value: number) => void
  label: React.ReactNode
  id?: string
  focusId?: string
  inputClassName?: string
  labelClassName?: string
}

export const TimeoutInputField = ({
  field,
  value,
  onValueChange,
  label,
  id = field.id,
  focusId,
  inputClassName,
  labelClassName
}: TimeoutInputFieldProps) => (
  <SettingsFormField
    htmlFor={id}
    focusId={focusId}
    label={
      <>
        <field.icon className="icon-xs" />
        {label}
      </>
    }
    labelClassName={labelClassName}>
    <Input
      id={id}
      type="number"
      min={field.min}
      max={field.max}
      step={field.step}
      value={value}
      onChange={(event) => {
        const parsed = Number.parseInt(event.target.value, 10) || field.min
        onValueChange(Math.max(field.min, Math.min(field.max, parsed)))
      }}
      className={inputClassName ?? "text-center"}
    />
  </SettingsFormField>
)

interface ScrollStrategyFieldProps {
  value: ScrollStrategy
  onValueChange: (value: ScrollStrategy) => void
  label: React.ReactNode
  description?: React.ReactNode
  id?: string
  focusId?: string
  compact?: boolean
  triggerClassName?: string
  labelClassName?: string
}

export const ScrollStrategyField = ({
  value,
  onValueChange,
  label,
  description,
  id = "scroll-strategy",
  focusId,
  compact = false,
  triggerClassName,
  labelClassName
}: ScrollStrategyFieldProps) => {
  const { t } = useTranslation()
  const options = compact
    ? SCROLL_STRATEGY_OPTIONS_SHORT
    : SCROLL_STRATEGY_OPTIONS

  return (
    <SettingsSelectField
      id={id}
      focusId={focusId}
      label={label}
      description={description}
      labelClassName={labelClassName}
      value={value}
      onValueChange={(next) => onValueChange(next as ScrollStrategy)}
      triggerClassName={triggerClassName}>
      {options.map((option) => (
        <SelectItem key={option.value} value={option.value}>
          {t(
            compact
              ? `settings.content_extraction.scroll_strategy.options_short.${option.value}`
              : `settings.content_extraction.scroll_strategy.options.${option.value}`
          )}
        </SelectItem>
      ))}
    </SettingsSelectField>
  )
}

interface ScrollDepthFieldProps {
  depth: number
  onValueChange: (value: number) => void
  label: React.ReactNode
  description?: React.ReactNode
  focusId?: string
}

export const ScrollDepthField = ({
  depth,
  onValueChange,
  label,
  description,
  focusId
}: ScrollDepthFieldProps) => {
  const percent = Math.round(depth * 100)
  return (
    <SettingsSliderField
      focusId={focusId}
      label={label}
      description={description}
      value={percent}
      valueLabel={`${percent}%`}
      min={0}
      max={100}
      step={5}
      onValueChange={(value) => onValueChange(value / 100)}
      leftLabel="0%"
      rightLabel="100%"
    />
  )
}
