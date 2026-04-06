import { useStorage } from "@plasmohq/storage/hook"

import { STORAGE_KEYS } from "@/lib/constants"

/**
 * Hook to manage the session metrics display preference
 * @returns [showSessionMetrics, setShowSessionMetrics] - Current value and setter
 */
export const useSessionMetricsPreference = () => {
  return useStorage<boolean>(STORAGE_KEYS.CHAT.SHOW_SESSION_METRICS, true)
}
