import { useStorage } from "@plasmohq/storage/hook"
import { useCallback, useEffect, useState } from "react"
import { useOpenTabs } from "@/features/tabs/hooks/use-open-tab"
import { useSelectedTabs } from "@/features/tabs/stores/selected-tabs-store"
import { browser } from "@/lib/browser-api"
import { MESSAGE_KEYS, STORAGE_KEYS } from "@/lib/constants"
import { plasmoGlobalStorage } from "@/lib/plasmo-global-storage"

import type { ChromeResponse } from "@/types"

const fetchTabContent = async (tabId: number): Promise<string> => {
  try {
    const response = (await browser.tabs.sendMessage(tabId, {
      type: MESSAGE_KEYS.BROWSER.GET_PAGE_CONTENT
    })) as ChromeResponse & { html?: string }
    return response?.html || ""
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    throw new Error(errorMessage)
  }
}
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

  useEffect(() => {
    if (selectedTabIds.length === 0) return

    const fetchAll = async () => {
      setLoading(true)
      const newContents: Record<number, { title: string; html: string }> = {}
      const newErrors: Record<number, string> = {}

      for (const idStr of selectedTabIds) {
        const tabId = parseInt(idStr, 10)

        try {
          const html = await fetchTabContent(tabId)
          const title = getTabTitle(tabId)
          // Optional: parse HTML to check it's valid, sanitize if needed
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
  }, [selectedTabIds, getTabTitle, setErrors])

  return { tabContents, loading, errors: useSelectedTabs().errors }
}
