import { useSetting } from "@/hooks/use-setting"
import { SETTINGS } from "@/lib/storage/settings"

/**
 * Hook to manage the session metrics display preference.
 *
 * Routes through the registered descriptor, which owns the sync scope and
 * keeps this preference consistent across extension surfaces and devices.
 *
 * @returns [showSessionMetrics, setShowSessionMetrics] - Current value and setter
 */
export const useSessionMetricsPreference = () => {
  return useSetting(SETTINGS.SHOW_SESSION_METRICS)
}
