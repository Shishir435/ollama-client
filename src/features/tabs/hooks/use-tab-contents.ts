import { useStorage } from "@plasmohq/storage/hook"
import { useCallback, useEffect, useState } from "react"
import { useOpenTabs } from "@/features/tabs/hooks/use-open-tab"
import { useSelectedTabs } from "@/features/tabs/stores/selected-tabs-store"
import { browser } from "@/lib/browser-api"
import { MESSAGE_KEYS, STORAGE_KEYS } from "@/lib/constants"
import { plasmoGlobalStorage } from "@/lib/plasmo-global-storage"

import type { ChromeResponse } from "@/types"

export const useTabContents = () => {
  const { selectedTabIds, setErrors } = useSelectedTabs()
  const [tabContents, setTabContents] = useState<
    Record<number, { title: string; html: string }>
  >({})
  const [loading, setLoading] = useState(false)
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
      try {
        const response = (await browser.tabs.sendMessage(tabId, {
          type: MESSAGE_KEYS.BROWSER.GET_PAGE_CONTENT
        })) as ChromeResponse & { html?: string; title?: string }

        const html = response?.html || ""
        // Use title from response, fallback to tab title, then "Untitled"
        const title = response?.title || getTabTitle(tabId) || "Untitled"

        return { html, title }
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : String(error)
        throw new Error(errorMessage)
      }
    },
    [getTabTitle]
  )

  useEffect(() => {
    if (selectedTabIds.length === 0) return

    const fetchAll = async () => {
      setLoading(true)
      const newContents: Record<number, { title: string; html: string }> = {}
      const newErrors: Record<number, string> = {}

      for (const idStr of selectedTabIds) {
        const tabId = parseInt(idStr, 10)

        try {
          const { html, title } = await fetchTabContent(tabId)
          newContents[tabId] = { html, title }
        } catch (err) {
          newErrors[tabId] = typeof err === "string" ? err : "Unknown error"
        }
      }

      setTabContents(newContents)
      setErrors(newErrors)
      setLoading(false)
    }

    fetchAll()
  }, [selectedTabIds, fetchTabContent, setErrors])

  return { tabContents, loading, errors: useSelectedTabs().errors }
}
