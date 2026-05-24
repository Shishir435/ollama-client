import { type ComponentProps, useState } from "react"
import {
  type RegisterOptions,
  useController,
  useFormContext
} from "react-hook-form"

import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"

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
  commitMode?: "change" | "blur"
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
  commitMode = "change",
  onBlur,
  className,
  ...props
}: ControlledNumberInputProps) => {
  const { control } = useFormContext()
  const { field, fieldState } = useController({
    control,
    name,
    rules: validation as RegisterOptions
  })
  const [draftValue, setDraftValue] = useState<string | null>(null)
  const renderedValue =
    draftValue ??
    (field.value === undefined || field.value === null
      ? ""
      : String(field.value))

  const commitValue = (raw: string) => {
    if (raw === "") {
      field.onChange(undefined)
      return
    }
    const parsed = Number(raw)
    field.onChange(Number.isNaN(parsed) ? raw : parsed)
  }

  return (
    <Input
      {...props}
      name={field.name}
      ref={field.ref}
      type="number"
      value={renderedValue}
      aria-invalid={fieldState.invalid || props["aria-invalid"]}
      className={cn("control-h-sm", className)}
      onChange={(event) => {
        const raw = event.currentTarget.value
        if (commitMode === "blur") {
          setDraftValue(raw)
        } else {
          commitValue(raw)
        }
      }}
      onBlur={(event) => {
        if (commitMode === "blur") {
          commitValue(event.currentTarget.value)
          setDraftValue(null)
        }
        field.onBlur()
        onBlur?.(event)
      }}
    />
  )
}
