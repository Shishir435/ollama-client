import { useEffect, useState } from "react"

import { MESSAGE_KEYS, STORAGE_KEYS } from "@/lib/constants"
import { plasmoGlobalStorage } from "@/lib/plasmo-global-storage"
import { useSelectedTabIds } from "@/features/tabs/context/selected-tab-ids-context"
import useOpenTabs from "@/features/tabs/hooks/use-open-tab"

import { useStorage } from "@plasmohq/storage/hook"

const fetchTabContent = (tabId: number) => {
  return new Promise<{ html: string; source: string }>((resolve, reject) => {
    chrome.tabs.sendMessage(
      tabId,
      { type: MESSAGE_KEYS.BROWSER.GET_PAGE_CONTENT },
      (response) => {
        if (chrome.runtime.lastError) {
          return reject(chrome.runtime.lastError.message)
        }

        if (!response || !response.html) {
          return reject("Empty response from content script.")
        }

        resolve({
          html: response.html,
          source: response.source || "unknown"
        })
      }
    )
  })
}

export const useTabContents = () => {
  const { selectedTabIds, setErrors } = useSelectedTabIds()

  const [tabContents, setTabContents] = useState<
    Record<number, { title: string; html: string; source: string }>
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

  const getTabTitle = (tabId: number) => {
    const tab = openTabs.find((tab) => tab.id === tabId)?.title
    return tab || ""
  }
  useEffect(() => {
    if (selectedTabIds.length === 0) return

    const fetchAll = async () => {
      setLoading(true)
      const newContents: Record<
        number,
        { title: string; html: string; source: string }
      > = {}
      const newErrors: Record<number, string> = {}

      for (const idStr of selectedTabIds) {
        const tabId = parseInt(idStr)

        try {
          const { html, source } = await fetchTabContent(tabId)
          const title = getTabTitle(tabId)
          newContents[tabId] = { html, title, source }
        } catch (err) {
          newErrors[tabId] = typeof err === "string" ? err : "Unknown error"
        }
      }

      setTabContents(newContents)
      setErrors(newErrors)
      setLoading(false)
    }

    fetchAll()
  }, [selectedTabIds])

  return { tabContents, loading, errors: useSelectedTabIds().errors }
}
