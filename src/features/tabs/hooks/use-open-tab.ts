import { useCallback, useEffect, useState } from "react"
import type { Tabs } from "webextension-polyfill"
import { MESSAGE_KEYS } from "@/lib/constants"
import { logger } from "@/lib/logger"
import { sendRuntimeMessage } from "@/lib/runtime-messages"

export const useOpenTabs = (enabled: boolean) => {
  const [tabs, setTabs] = useState<Tabs.Tab[]>([])

  const fetchTabs = useCallback(async () => {
    if (!enabled) return
    try {
      const response = await sendRuntimeMessage(MESSAGE_KEYS.BROWSER.OPEN_TAB)
      if (response?.tabs && Array.isArray(response.tabs)) {
        setTabs(response.tabs)
      }
    } catch (error) {
      logger.error("Failed to fetch tabs", "useOpenTab", { error })
    }
  }, [enabled])

  useEffect(() => {
    fetchTabs()
  }, [fetchTabs])

  return { tabs, refreshTabs: fetchTabs }
}
