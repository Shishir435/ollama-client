import type { RegisterOptions } from "react-hook-form"
import { useFormContext } from "react-hook-form"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
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
    <div className="space-y-2">
      <Label
        htmlFor={name}
        className={Icon ? "flex items-center gap-2 text-sm" : "text-sm"}>
        {Icon && <Icon className="h-3 w-3" />}
        {label}
      </Label>
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
      {fieldErrors && (
        <p className="text-xs text-red-600">{fieldErrors.message as string}</p>
      )}
    </div>
  )
}
