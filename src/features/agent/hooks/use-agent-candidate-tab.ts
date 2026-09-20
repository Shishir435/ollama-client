import { useCallback, useEffect, useState } from "react"

import { browser } from "@/lib/browser-api"
import { classifyAgentTabAccess } from "@/lib/browser-tab-access"

export interface AgentCandidateTab {
  id: number
  title: string
  url: string
}

/**
 * The tab a run would control if it started now.
 *
 * Resolved in the panel rather than the background: a service worker has no
 * current window, so "the active tab" there means the last focused window's —
 * which is DevTools, or another window entirely, exactly when the user is
 * looking at the page they want driven. The panel lives in the window it is
 * asking about.
 *
 * A page the run could not read resolves to nothing, so Start stays disabled
 * instead of failing after the click.
 */
export const useAgentCandidateTab = (): AgentCandidateTab | undefined => {
  const [tab, setTab] = useState<AgentCandidateTab>()

  const refresh = useCallback(() => {
    void (async () => {
      try {
        const [active] = await browser.tabs.query({
          active: true,
          currentWindow: true
        })
        if (
          typeof active?.id !== "number" ||
          !active?.url ||
          (await classifyAgentTabAccess(active.url)) !== "ok"
        ) {
          setTab(undefined)
          return
        }
        setTab({ id: active.id, title: active.title ?? "", url: active.url })
      } catch {
        setTab(undefined)
      }
    })()
  }, [])

  useEffect(() => {
    refresh()
    const onUpdated = (
      _tabId: number,
      changeInfo: { url?: string; status?: string; title?: string }
    ) => {
      if (
        changeInfo.url ||
        changeInfo.title ||
        changeInfo.status === "complete"
      ) {
        refresh()
      }
    }
    browser.tabs.onActivated.addListener(refresh)
    browser.tabs.onUpdated.addListener(onUpdated)
    window.addEventListener("focus", refresh)
    return () => {
      browser.tabs.onActivated.removeListener(refresh)
      browser.tabs.onUpdated.removeListener(onUpdated)
      window.removeEventListener("focus", refresh)
    }
  }, [refresh])

  return tab
}
