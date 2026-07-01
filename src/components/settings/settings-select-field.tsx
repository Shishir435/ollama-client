import React, { useMemo } from "react"
import {
  Select,
  SelectContent,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select"
import { SettingsFormField } from "./settings-form-field"

export interface SettingsSelectFieldProps {
  label: React.ReactNode
  description?: React.ReactNode
  error?: string
  value: string
  onValueChange: (value: string) => void
  placeholder?: string
  valueLabel?: React.ReactNode
  children: React.ReactNode
  id?: string
  className?: string
  triggerClassName?: string
  labelClassName?: string
  focusId?: string
  disabled?: boolean
}

export const SettingsSelectField = ({
  label,
  description,
  error,
  value,
  onValueChange,
  placeholder,
  valueLabel,
  children,
  id,
  className,
  triggerClassName,
  labelClassName,
  focusId,
  disabled
}: SettingsSelectFieldProps) => {
  const autoValueLabel = useMemo(() => {
    if (valueLabel) return valueLabel
    const map = new Map<string, React.ReactNode>()
    React.Children.forEach(children, (child) => {
      if (React.isValidElement(child)) {
        // biome-ignore lint/suspicious/noExplicitAny: select item props are external
        const element = child as React.ReactElement<any>
        if (element.props?.value !== undefined) {
          map.set(String(element.props.value), element.props.children)
        }
      }
    })
    return map.get(value)
  }, [children, value, valueLabel])

  return (
    <SettingsFormField
      htmlFor={id}
      focusId={focusId}
      label={label}
      description={description}
      error={error}
      className={className}
      labelClassName={labelClassName}>
      <Select
        value={value}
        onValueChange={(v) => {
          if (v !== null) onValueChange(v)
        }}
        disabled={disabled}>
        <SelectTrigger id={id} className={triggerClassName}>
          <SelectValue placeholder={placeholder}>
            {autoValueLabel ? () => autoValueLabel : undefined}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>{children}</SelectContent>
      </Select>
    </SettingsFormField>
  )
}
