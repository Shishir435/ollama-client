import { useCallback, useEffect, useState } from "react"
import type { Tabs } from "webextension-polyfill"
import { MESSAGE_KEYS } from "@/lib/constants"
import { logger } from "@/lib/logger"
import { sendRuntimeMessage } from "@/lib/retained-runtime-messages"

export const useOpenTabs = (enabled: boolean) => {
  const [tabs, setTabs] = useState<Tabs.Tab[]>([])

  const readTabs = useCallback(async () => {
    if (!enabled) return null
    try {
      const response = await sendRuntimeMessage(MESSAGE_KEYS.BROWSER.OPEN_TAB)
      if (response?.tabs && Array.isArray(response.tabs)) {
        return response.tabs
      }
      return null
    } catch (error) {
      logger.error("Failed to fetch tabs", "useOpenTab", { error })
      return null
    }
  }, [enabled])

  const fetchTabs = useCallback(async () => {
    const next = await readTabs()
    if (next) setTabs(next)
  }, [readTabs])

  useEffect(() => {
    if (!enabled) return
    let active = true
    void readTabs().then((next) => {
      if (active && next) setTabs(next)
    })
    return () => {
      active = false
    }
  }, [enabled, readTabs])

  return { tabs, refreshTabs: fetchTabs }
}
