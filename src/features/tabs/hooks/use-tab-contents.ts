import { useStorage } from "@plasmohq/storage/hook"
import { useCallback, useEffect, useRef, useState } from "react"
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
  // Tracks IDs that have already been fetched (or are in-flight) to prevent
  // the fetch effect from re-triggering when tabContents/loadingIds update.
  const fetchedIdsRef = useRef<Set<number>>(new Set())
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

    // 1. Cleanup removed tabs from contents, errors, and the fetched-IDs ref
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

    // Remove de-selected tab IDs from the ref so they can be re-fetched if re-added
    fetchedIdsRef.current.forEach((id) => {
      if (!currentTabIds.includes(id)) {
        fetchedIdsRef.current.delete(id)
      }
    })
  }, [selectedTabIds, setErrors])

  // Separate effect for fetching new content to keep cleanup independent.
  // Uses fetchedIdsRef (a ref, not state) to track in-flight/completed fetches so
  // this effect does NOT need tabContents or loadingIds as dependencies — avoiding
  // the infinite re-render loop that those state deps would cause (BUG-01).
  useEffect(() => {
    const currentTabIds = selectedTabIds.map((id) => parseInt(id, 10))
    const newTabIds = currentTabIds.filter(
      (id) => !fetchedIdsRef.current.has(id)
    )

    if (newTabIds.length === 0) return

    // Mark all new IDs as in-flight BEFORE any async work to prevent duplicate fetches
    for (const id of newTabIds) {
      fetchedIdsRef.current.add(id)
    }

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
          // On error, remove from ref so the tab can be retried if re-selected
          fetchedIdsRef.current.delete(tabId)
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
  }, [selectedTabIds, fetchTabContent, setErrors])

  return { tabContents, loadingIds, errors }
}
