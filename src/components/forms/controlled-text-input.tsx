import type React from "react"
import { useController, useFormContext } from "react-hook-form"

import { Input } from "@/components/ui/input"

type InputProps = React.ComponentProps<typeof Input>

export interface ControlledTextInputProps
  extends Omit<InputProps, "name" | "value" | "defaultValue" | "onChange"> {
  name: string
}

export const ControlledTextInput = ({
  name,
  onBlur,
  ...props
}: ControlledTextInputProps) => {
  const { control } = useFormContext()
  const { field } = useController({ control, name })

  return (
    <Input
      {...props}
      name={field.name}
      ref={field.ref}
      value={field.value ?? ""}
      onChange={field.onChange}
      onBlur={(event) => {
        field.onBlur()
        onBlur?.(event)
      }}
    />
  )
}
