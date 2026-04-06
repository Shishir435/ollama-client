import { TIMEOUT_FIELDS_CONFIG } from "@/lib/constants-ui"
import { Clock, Globe, RefreshCw } from "@/lib/lucide-icon"

// Icon mapping for timeout fields
export const TIMEOUT_FIELD_ICONS = {
  "scroll-delay": Clock,
  "mutation-timeout": RefreshCw,
  "network-timeout": Globe,
  "max-wait": Clock
} as const

// Create TIMEOUT_FIELDS with icons
export const TIMEOUT_FIELDS = TIMEOUT_FIELDS_CONFIG.map((field) => ({
  ...field,
  icon: TIMEOUT_FIELD_ICONS[field.id]
})) as Array<
  (typeof TIMEOUT_FIELDS_CONFIG)[number] & {
    icon: (typeof TIMEOUT_FIELD_ICONS)[keyof typeof TIMEOUT_FIELD_ICONS]
  }
>
