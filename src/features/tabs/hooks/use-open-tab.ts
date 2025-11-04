import { useCallback, useEffect, useState } from "react"
import type { Tabs } from "webextension-polyfill"
import { browser } from "@/lib/browser-api"
import { MESSAGE_KEYS } from "@/lib/constants"
import type { ChromeResponse } from "@/types"

export const useOpenTabs = (enabled: boolean) => {
  const [tabs, setTabs] = useState<Tabs.Tab[]>([])

  const fetchTabs = useCallback(async () => {
    if (!enabled) return
    try {
      const response = (await browser.runtime.sendMessage({
        type: MESSAGE_KEYS.BROWSER.OPEN_TAB
      })) as ChromeResponse & { tabs?: Tabs.Tab[] }
      if (response?.tabs && Array.isArray(response.tabs)) {
        setTabs(response.tabs)
      }
    } catch (error) {
      console.error("Failed to fetch tabs:", error)
    }
  }, [enabled])

  useEffect(() => {
    fetchTabs()
  }, [fetchTabs])

  return { tabs, refreshTabs: fetchTabs }
}
