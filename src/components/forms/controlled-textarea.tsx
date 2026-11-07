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
  const { field } = useController({ control, name })
  const {
    name: fieldName,
    ref: fieldRef,
    value: fieldValue,
    onChange: handleChange,
    onBlur: handleBlur
  } = field

  return (
    <Textarea
      {...props}
      name={fieldName}
      ref={fieldRef}
      value={fieldValue ?? ""}
      onChange={handleChange}
      onBlur={(event) => {
        handleBlur()
        onBlur?.(event)
      }}
    />
  )
}
