import type React from "react"
import { useController, useFormContext } from "react-hook-form"
import { Textarea } from "@/components/ui/textarea"

type TextareaProps = React.ComponentProps<typeof Textarea>

export interface ControlledTextareaProps extends Omit<
  TextareaProps,
  "name" | "value" | "defaultValue" | "onChange"
> {
  name: string
}

export const ControlledTextarea = ({
  name,
  onBlur,
  ...props
}: ControlledTextareaProps) => {
  const { control } = useFormContext()
  const {
    field: { name: fieldName, ref, value, onChange, onBlur: fieldOnBlur }
  } = useController({ control, name })

  return (
    <Textarea
      {...props}
      name={fieldName}
      ref={ref}
      value={value ?? ""}
      onChange={onChange}
      onBlur={(event) => {
        fieldOnBlur()
        onBlur?.(event)
      }}
    />
  )
}
