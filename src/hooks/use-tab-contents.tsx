import { useEffect, useState } from "react"

import useOpenTabs from "@/hooks/use-open-tab"
import { useSelectedTabIds } from "@/context/selected-tab-ids-context"
import { MESSAGE_KEYS, STORAGE_KEYS } from "@/lib/constant"
import { plasmoGlobalStorage } from "@/lib/plasmo-global-storage"

import { useStorage } from "@plasmohq/storage/hook"

const fetchTabContent = (tabId: number) => {
  return new Promise<string>((resolve, reject) => {
    chrome.tabs.sendMessage(
      tabId,
      { type: MESSAGE_KEYS.BROWSER.GET_PAGE_CONTENT },
      (response) => {
        if (chrome.runtime.lastError) {
          return reject(chrome.runtime.lastError.message)
        }
        resolve(response?.html || "")
      }
    )
  })
}
export const useTabContents = () => {
  const { selectedTabIds, setErrors } = useSelectedTabIds()
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

  const getTabTitle = (tabId: number) => {
    const tab = openTabs.find((tab) => tab.id === tabId)?.title
    return tab || ""
  }
  useEffect(() => {
    if (selectedTabIds.length === 0) return

    const fetchAll = async () => {
      setLoading(true)
      const newContents: Record<number, { title: string; html: string }> = {}
      const newErrors: Record<number, string> = {}

      for (const idStr of selectedTabIds) {
        const tabId = parseInt(idStr)

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
  }, [selectedTabIds])

  return { tabContents, loading, errors: useSelectedTabIds().errors }
}
