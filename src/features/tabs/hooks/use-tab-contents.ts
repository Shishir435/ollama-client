import { useStorage } from "@plasmohq/storage/hook"
import { useCallback, useEffect } from "react"
import { create } from "zustand"
import { useOpenTabs } from "@/features/tabs/hooks/use-open-tab"
import { useSelectedTabs } from "@/features/tabs/stores/selected-tabs-store"
import { browser } from "@/lib/browser-api"
import { MESSAGE_KEYS, STORAGE_KEYS } from "@/lib/constants"
import { plasmoGlobalStorage } from "@/lib/plasmo-global-storage"
import type { ChromeResponse } from "@/types"

interface TabFetchingState {
  tabContents: Record<number, { title: string; html: string }>
  loadingIds: Record<number, boolean>
  fetchedIds: number[]
  fetchTabContent: (
    tabId: number,
    fallbackTitle: string,
    setErrors: (
      updater: (prev: Record<number, string>) => Record<number, string>
    ) => void
  ) => Promise<void>
  cleanupRemovedTabs: (
    currentTabIds: number[],
    setErrors: (
      updater: (prev: Record<number, string>) => Record<number, string>
    ) => void
  ) => void
}

const useTabFetchingStore = create<TabFetchingState>((set, get) => ({
  tabContents: {},
  loadingIds: {},
  fetchedIds: [],

  fetchTabContent: async (tabId, fallbackTitle, setErrors) => {
    const state = get()
    // Deduplicate: if already fetched or in-flight across ANY hook instance, abort.
    if (state.fetchedIds.includes(tabId) || state.loadingIds[tabId]) {
      return
    }

    set((s) => ({
      fetchedIds: [...s.fetchedIds, tabId],
      loadingIds: { ...s.loadingIds, [tabId]: true }
    }))

    try {
      const response = (await browser.tabs.sendMessage(tabId, {
        type: MESSAGE_KEYS.BROWSER.GET_PAGE_CONTENT
      })) as ChromeResponse & { html?: string; title?: string }

      const html = response?.html || ""
      const title = response?.title || fallbackTitle || "Untitled"

      set((s) => ({
        tabContents: { ...s.tabContents, [tabId]: { html, title } },
        loadingIds: { ...s.loadingIds, [tabId]: false }
      }))
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err)
      setErrors((prev) => ({ ...prev, [tabId]: errorMessage }))
      set((s) => {
        const newLoading = { ...s.loadingIds }
        delete newLoading[tabId]
        return {
          loadingIds: newLoading,
          fetchedIds: s.fetchedIds.filter((id) => id !== tabId)
        }
      })
    }
  },

  cleanupRemovedTabs: (currentTabIds, setErrors) => {
    set((s) => {
      const nextContents = { ...s.tabContents }
      let contentsChanged = false
      for (const idStr in nextContents) {
        const id = parseInt(idStr, 10)
        if (!currentTabIds.includes(id)) {
          delete nextContents[id]
          contentsChanged = true
        }
      }

      const nextFetched = s.fetchedIds.filter((id) =>
        currentTabIds.includes(id)
      )
      const fetchedChanged = nextFetched.length !== s.fetchedIds.length

      return contentsChanged || fetchedChanged
        ? { tabContents: nextContents, fetchedIds: nextFetched }
        : s
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
  }
}))

export const useTabContents = () => {
  const { selectedTabIds, errors, setErrors } = useSelectedTabs()
  const { tabContents, loadingIds, fetchTabContent, cleanupRemovedTabs } =
    useTabFetchingStore()

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
    const currentTabIds = selectedTabIds.map((id) => parseInt(id, 10))
    cleanupRemovedTabs(currentTabIds, setErrors)
  }, [selectedTabIds, setErrors, cleanupRemovedTabs])

  useEffect(() => {
    const currentTabIds = selectedTabIds.map((id) => parseInt(id, 10))
    currentTabIds.forEach((tabId) => {
      // fetchTabContent internally checks get() to avoid duplicates
      // even if multiple useTabContents hooks mount simultaneously.
      fetchTabContent(tabId, getTabTitle(tabId), setErrors)
    })
  }, [selectedTabIds, getTabTitle, fetchTabContent, setErrors])

  return { tabContents, loadingIds, errors }
}
