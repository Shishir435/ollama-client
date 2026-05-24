import type { ComponentProps } from "react"
import {
  type RegisterOptions,
  useController,
  useFormContext
} from "react-hook-form"

import { Input } from "@/components/ui/input"

export type ControlledNumberInputValidation = Omit<
  RegisterOptions,
  "valueAsNumber" | "valueAsDate" | "pattern"
> & {
  min?: { value: number; message: string }
  max?: { value: number; message: string }
}

export interface ControlledNumberInputProps
  extends Omit<
    ComponentProps<typeof Input>,
    "name" | "type" | "value" | "defaultValue" | "onChange"
  > {
  name: string
  validation?: ControlledNumberInputValidation
}

/**
 * React Hook Form-safe numeric input.
 *
 * Keep this app-owned wrapper between feature forms and the shadcn/Base UI
 * primitive so preset refreshes cannot silently break numeric persistence.
 */
export const ControlledNumberInput = ({
  name,
  validation,
  onBlur,
  ...props
}: ControlledNumberInputProps) => {
  const { control } = useFormContext()
  const { field } = useController({
    control,
    name,
    rules: validation as RegisterOptions
  })

  return (
    <Input
      {...props}
      name={field.name}
      ref={field.ref}
      type="number"
      value={
        field.value === undefined || field.value === null
          ? ""
          : (field.value as number | string)
      }
      onChange={(event) => {
        const raw = event.currentTarget.value
        if (raw === "") {
          field.onChange(undefined)
          return
        }
        const parsed = Number(raw)
        field.onChange(Number.isNaN(parsed) ? raw : parsed)
      }}
      onBlur={(event) => {
        field.onBlur()
        onBlur?.(event)
      }}
    />
  )
}
