import type { RegisterOptions } from "react-hook-form"
import { useFormContext } from "react-hook-form"

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

interface FormNumberInputProps {
  name: string
  label: string
  icon?: LucideIcon
  min?: number
  max?: number
  step?: number
  validation?: NumberInputValidation
  className?: string
}

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
  const {
    register,
    formState: { errors }
  } = useFormContext()

  const fieldErrors = errors[name as keyof typeof errors]

  return (
    <SettingsFormField
      htmlFor={name}
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
      error={fieldErrors ? (fieldErrors.message as string) : undefined}>
      <Input
        id={name}
        type="number"
        min={min}
        max={max}
        step={step}
        {...register(name, {
          ...validation,
          valueAsNumber: true
        } as RegisterOptions)}
        className={className}
      />
    </SettingsFormField>
  )
}
