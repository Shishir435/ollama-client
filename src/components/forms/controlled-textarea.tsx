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

  return (
    <Textarea
      {...props}
      name={field.name}
      ref={field.ref}
      // oxlint-disable-next-line react/refs -- React Hook Form values and event callbacks are ordinary data; the forwarded callback ref does not make them RefObject reads.
      value={field.value ?? ""}
      onChange={field.onChange}
      onBlur={(event) => {
        field.onBlur()
        onBlur?.(event)
      }}
    />
  )
}
