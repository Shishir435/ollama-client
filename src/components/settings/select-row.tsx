import React, { useMemo } from "react"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select"
import { cn } from "@/lib/utils"

interface SelectRowProps {
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
}

export const SelectRow = ({
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
  triggerClassName
}: SelectRowProps) => {
  const autoValueLabel = useMemo(() => {
    if (valueLabel) return valueLabel
    const map = new Map<string, React.ReactNode>()
    React.Children.forEach(children, (child) => {
      if (React.isValidElement(child)) {
        // biome-ignore lint/suspicious/noExplicitAny: React element props can be anything
        const element = child as React.ReactElement<any>
        if (element.props?.value !== undefined) {
          map.set(String(element.props.value), element.props.children)
        }
      }
    })
    return map.get(value)
  }, [children, value, valueLabel])

  return (
    <div className={cn("space-y-2", className)}>
      <Label htmlFor={id} className="flex items-center gap-2 text-sm">
        {label}
      </Label>
      {description && (
        <p className="text-xs text-muted-foreground">{description}</p>
      )}
      <Select value={value} onValueChange={onValueChange}>
        <SelectTrigger id={id} className={triggerClassName}>
          <SelectValue placeholder={placeholder}>
            {autoValueLabel ? () => autoValueLabel : undefined}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>{children}</SelectContent>
      </Select>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  )
}
