import { Clock, Globe, RefreshCw } from "lucide-react"
import { TIMEOUT_FIELDS_CONFIG } from "@/lib/constants-ui"

/** Component icon mapping kept outside the UI-independent field definitions. */
export const TIMEOUT_FIELD_ICONS = {
  "scroll-delay": Clock,
  "mutation-timeout": RefreshCw,
  "network-timeout": Globe,
  "max-wait": Clock
} as const

/** Timeout field definitions enriched for direct component rendering. */
export const TIMEOUT_FIELDS = TIMEOUT_FIELDS_CONFIG.map((field) => ({
  ...field,
  icon: TIMEOUT_FIELD_ICONS[field.id]
})) as Array<
  (typeof TIMEOUT_FIELDS_CONFIG)[number] & {
    icon: (typeof TIMEOUT_FIELD_ICONS)[keyof typeof TIMEOUT_FIELD_ICONS]
  }
>
