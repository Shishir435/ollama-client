import { useId } from "react"
import {
  type RegisterOptions,
  useController,
  useFormContext
} from "react-hook-form"

import { SettingsFormField } from "@/components/settings"
import { Input } from "@/components/ui/input"
import type { LucideIcon } from "@/lib/lucide-icon"

export type NumberInputValidation = Omit<
  RegisterOptions,
  "valueAsNumber" | "valueAsDate" | "pattern"
> & {
  min?: { value: number; message: string }
  max?: { value: number; message: string }
}

export interface FormNumberInputProps {
  name: string
  label: string
  icon?: LucideIcon
  min?: number
  max?: number
  step?: number
  validation?: NumberInputValidation
  className?: string
}

/**
 * Controlled number input bound to react-hook-form via `useController`.
 *
 * Why not `register()`: the shadcn `Input` we render here is a thin
 * wrapper around `@base-ui/react/input`, which is a *controlled*
 * primitive. Spread-registering an `onChange` handler from RHF does
 * not propagate through Base UI's internal value flow, so the form
 * state never sees user input -- the field looks live but never
 * saves. The slider had the same issue and was fixed earlier by
 * moving to `useController`; same fix here.
 *
 * Parsing rules:
 *   - empty string -> undefined (treated as "no change" by the
 *     parent's debounced save, which only writes through validated
 *     numeric updates).
 *   - non-numeric -> NaN, which the parent's per-field validation
 *     skips. Avoids spurious writes during in-progress typing
 *     (e.g. "-" while typing "-1").
 */
export const FormNumberInput = ({
  name,
  label,
  icon: Icon,
  min,
  max,
  step,
  validation,
  className = "text-center"
}: FormNumberInputProps) => {
  const { control } = useFormContext()
  const reactId = useId()
  const inputId = `${name}-${reactId}`
  const { field, fieldState } = useController({
    control,
    name,
    rules: validation as RegisterOptions
  })

  return (
    <SettingsFormField
      htmlFor={inputId}
      label={
        Icon ? (
          <div className="flex items-center gap-2">
            <Icon className="h-3 w-3" />
            <span>{label}</span>
          </div>
        ) : (
          label
        )
      }
      error={fieldState.error?.message}>
      <Input
        id={inputId}
        name={field.name}
        ref={field.ref}
        type="number"
        min={min}
        max={max}
        step={step}
        // `field.value` is whatever the form state currently holds
        // (number | undefined). Render as empty string for undefined
        // to keep the input uncontrolled-feeling while staying bound.
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
        onBlur={field.onBlur}
        className={className}
      />
    </SettingsFormField>
  )
}
