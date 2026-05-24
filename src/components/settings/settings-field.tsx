import type React from "react"

import { SettingsFormField } from "./settings-form-field"

export type SettingsFieldProps = React.ComponentProps<typeof SettingsFormField>

export const SettingsField = (props: SettingsFieldProps) => (
  <SettingsFormField {...props} />
)
