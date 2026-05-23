import { useStorage } from "@plasmohq/storage/hook"

import { STORAGE_KEYS } from "@/lib/constants"
import { plasmoGlobalStorage } from "@/lib/plasmo-global-storage"

/**
 * Hook to manage the session metrics display preference.
 *
 * Routes through `plasmoGlobalStorage` (chrome.storage.sync) like
 * every other persisted user preference. Calling `useStorage` with
 * a bare string key would default to chrome.storage.local, which
 * would silo this preference away from every other setting -- it
 * wouldn't sync across devices, wouldn't appear in backup exports,
 * and wouldn't survive a "reset all data" pass that targets sync.
 *
 * @returns [showSessionMetrics, setShowSessionMetrics] - Current value and setter
 */
export const useSessionMetricsPreference = () => {
  return useStorage<boolean>(
    {
      key: STORAGE_KEYS.CHAT.SHOW_SESSION_METRICS,
      instance: plasmoGlobalStorage
    },
    true
  )
}
