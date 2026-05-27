import type React from "react"
import { useController, useFormContext } from "react-hook-form"

import {
  Select,
  SelectContent,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select"

export interface ControlledSelectProps {
  name: string
  children: React.ReactNode
  placeholder?: string
  className?: string
  triggerClassName?: string
  id?: string
}

export const ControlledSelect = ({
  name,
  children,
  placeholder,
  className,
  triggerClassName,
  id
}: ControlledSelectProps) => {
  const { control } = useFormContext()
  const { field } = useController({ control, name })

  return (
    <Select
      value={field.value ?? ""}
      onValueChange={field.onChange}
      name={field.name}>
      <SelectTrigger id={id} className={triggerClassName}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent className={className}>{children}</SelectContent>
    </Select>
  )
}
