import type React from "react"
import { useController, useFormContext } from "react-hook-form"

import { Switch } from "@/components/ui/switch"

type SwitchProps = React.ComponentProps<typeof Switch>

export interface ControlledSwitchProps
  extends Omit<
    SwitchProps,
    "name" | "checked" | "defaultChecked" | "onCheckedChange"
  > {
  name: string
}

export const ControlledSwitch = ({ name, ...props }: ControlledSwitchProps) => {
  const { control } = useFormContext()
  const { field } = useController({ control, name })

  return (
    <Switch
      {...props}
      name={field.name}
      checked={Boolean(field.value)}
      onCheckedChange={field.onChange}
    />
  )
}
