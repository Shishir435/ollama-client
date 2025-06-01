import { useEffect, useState } from "react"

import { MESSAGE_KEYS } from "@/lib/constant"

function useOpenTabs(enabled: boolean) {
  const [tabs, setTabs] = useState<chrome.tabs.Tab[]>([])

  useEffect(() => {
    if (!enabled) return

    chrome.runtime.sendMessage(
      { type: MESSAGE_KEYS.BROWSER.OPEN_TAB },
      (response) => {
        if (response?.tabs && Array.isArray(response.tabs)) {
          setTabs(response.tabs as chrome.tabs.Tab[])
        }
      }
    )
  }, [enabled])

  return tabs
}

export default useOpenTabs
