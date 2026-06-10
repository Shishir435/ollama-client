import { type ComponentProps, useId, useState } from "react"
import {
  type RegisterOptions,
  useController,
  useFormContext,
  useFormState
} from "react-hook-form"

import { SettingsFormField } from "@/components/settings"
import { Input } from "@/components/ui/input"
import type { LucideIcon } from "@/lib/lucide-icon"
import { cn } from "@/lib/utils"

export type ControlledNumberInputValidation = Omit<
  RegisterOptions,
  "valueAsNumber" | "valueAsDate" | "pattern"
> & {
  min?: { value: number; message: string }
  max?: { value: number; message: string }
}

export type NumberInputValidation = ControlledNumberInputValidation

export interface ControlledNumberInputProps
  extends Omit<
    ComponentProps<typeof Input>,
    "name" | "type" | "value" | "defaultValue" | "onChange"
  > {
  name: string
  validation?: ControlledNumberInputValidation
  commitMode?: "change" | "blur"
  label?: string
  icon?: LucideIcon
}

/**
 * React Hook Form-safe numeric input.
 *
 * Keep this app-owned wrapper between feature forms and the shadcn/Base UI
 * primitive so preset refreshes cannot silently break numeric persistence.
 *
 * Optionally renders a SettingsFormField label wrapper when `label` is provided.
 */
export const ControlledNumberInput = ({
  name,
  validation,
  commitMode = "change",
  onBlur,
  className,
  label,
  icon: Icon,
  ...props
}: ControlledNumberInputProps) => {
  const { control, getFieldState } = useFormContext()
  const reactId = useId()
  const inputId = label ? `${name}-${reactId}` : props.id
  const formState = useFormState({ control, name })
  const { field, fieldState } = useController({
    control,
    name,
    rules: validation as RegisterOptions
  })
  const { error } = getFieldState(name, formState)
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

  const input = (
    <Input
      {...props}
      id={inputId}
      name={field.name}
      ref={field.ref}
      type="number"
      value={renderedValue}
      aria-invalid={fieldState.invalid || props["aria-invalid"]}
      className={cn("control-h-sm", className ?? "text-center")}
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

  if (!label) return input

  return (
    <SettingsFormField
      htmlFor={inputId}
      label={
        Icon ? (
          <div className="flex items-center gap-2">
            <Icon className="icon-xs" />
            <span>{label}</span>
          </div>
        ) : (
          label
        )
      }
      error={error?.message}>
      {input}
    </SettingsFormField>
  )
}
