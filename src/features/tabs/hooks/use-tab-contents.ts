import { useStorage } from "@plasmohq/storage/hook"
import { useCallback, useEffect, useState } from "react"
import { useOpenTabs } from "@/features/tabs/hooks/use-open-tab"
import { useSelectedTabs } from "@/features/tabs/stores/selected-tabs-store"
import { browser } from "@/lib/browser-api"
import { MESSAGE_KEYS, STORAGE_KEYS } from "@/lib/constants"
import { plasmoGlobalStorage } from "@/lib/plasmo-global-storage"

import type { ChromeResponse } from "@/types"

export const useTabContents = () => {
  const { selectedTabIds, errors, setErrors } = useSelectedTabs()
  const [tabContents, setTabContents] = useState<
    Record<number, { title: string; html: string }>
  >({})
  const [loadingIds, setLoadingIds] = useState<Record<number, boolean>>({})
  const [tabAccess] = useStorage<boolean>(
    {
      key: STORAGE_KEYS.BROWSER.TABS_ACCESS,
      instance: plasmoGlobalStorage
    },
    false
  )

  const { tabs: openTabs } = useOpenTabs(tabAccess)

  const getTabTitle = useCallback(
    (tabId: number) => {
      const tab = openTabs.find((tab) => tab.id === tabId)?.title
      return tab || ""
    },
    [openTabs]
  )

  const fetchTabContent = useCallback(
    async (tabId: number): Promise<{ html: string; title: string }> => {
      const response = (await browser.tabs.sendMessage(tabId, {
        type: MESSAGE_KEYS.BROWSER.GET_PAGE_CONTENT
      })) as ChromeResponse & { html?: string; title?: string }

      const html = response?.html || ""
      const title = response?.title || getTabTitle(tabId) || "Untitled"

      return { html, title }
    },
    [getTabTitle]
  )

  useEffect(() => {
    const currentTabIds = selectedTabIds.map((id) => parseInt(id, 10))

    // 1. Cleanup removed tabs from contents and errors
    setTabContents((prev) => {
      const next = { ...prev }
      let changed = false
      for (const idStr in next) {
        const id = parseInt(idStr, 10)
        if (!currentTabIds.includes(id)) {
          delete next[id]
          changed = true
        }
      }
      return changed ? next : prev
    })

    setErrors((prev) => {
      const next = { ...prev }
      let changed = false
      for (const idStr in next) {
        const id = parseInt(idStr, 10)
        if (!currentTabIds.includes(id)) {
          delete next[id]
          changed = true
        }
      }
      return changed ? next : prev
    })

    // 2. Identify new tabs by checking against current state
    // Note: We use a small hack to get the latest tabContents without depending on it
    // by doing the identification inside a "no-op" setTabContents call or just relying on the fact
    // that we'll filter new ones in the fetch loop.
    // Actually, it's better to just use a ref or accept that we might re-fetch if we are not careful.
    // But wait, we can just use the selectedTabIds and content we have.
  }, [selectedTabIds, setErrors]) // Corrected dependencies

  // Separate effect for fetching new content to keep cleanup independent
  useEffect(() => {
    const currentTabIds = selectedTabIds.map((id) => parseInt(id, 10))
    const newTabIds = currentTabIds.filter(
      (id) => !tabContents[id] && !loadingIds[id]
    )

    if (newTabIds.length === 0) return

    const fetchNewTabs = async () => {
      setLoadingIds((prev) => {
        const next = { ...prev }
        for (const id of newTabIds) {
          next[id] = true
        }
        return next
      })

      for (const tabId of newTabIds) {
        try {
          const content = await fetchTabContent(tabId)
          setTabContents((prev) => ({ ...prev, [tabId]: content }))
          setErrors((prev) => {
            if (prev[tabId]) {
              const next = { ...prev }
              delete next[tabId]
              return next
            }
            return prev
          })
        } catch (err) {
          const errorMessage = err instanceof Error ? err.message : String(err)
          setErrors((prev) => ({ ...prev, [tabId]: errorMessage }))
        } finally {
          setLoadingIds((prev) => {
            const next = { ...prev }
            delete next[tabId]
            return next
          })
        }
      }
    }

    fetchNewTabs()
  }, [selectedTabIds, fetchTabContent, setErrors, tabContents, loadingIds])

  return { tabContents, loadingIds, errors }
}
