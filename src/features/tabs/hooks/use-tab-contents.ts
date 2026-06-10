import { useStorage } from "@plasmohq/storage/hook"
import { useCallback, useEffect } from "react"
import { create } from "zustand"
import { useOpenTabs } from "@/features/tabs/hooks/use-open-tab"
import { useSelectedTabs } from "@/features/tabs/stores/selected-tabs-store"
import { browser } from "@/lib/browser-api"
import {
  MESSAGE_KEYS,
  STORAGE_KEYS,
  TAB_CONTENT_REFRESH_INTERVAL_MS
} from "@/lib/constants"
import { getDisplayErrorMessage } from "@/lib/error-display"
import { plasmoGlobalStorage } from "@/lib/plasmo-global-storage"
import type { ChromeResponse } from "@/types"

interface TabFetchingState {
  tabContents: Record<
    number,
    {
      title: string
      html: string
      extractionDebug?: ChromeResponse["extractionDebug"]
    }
  >
  loadingIds: Record<number, boolean>
  fetchedIds: number[]
  updatedIds: Record<number, boolean>
  fetchTabContent: (
    tabId: number,
    fallbackTitle: string,
    setErrors: (
      updater: (prev: Record<number, string>) => Record<number, string>
    ) => void,
    force?: boolean
  ) => Promise<void>
  clearUpdatedFlag: (tabId: number) => void
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
  updatedIds: {},

  fetchTabContent: async (tabId, fallbackTitle, setErrors, force = false) => {
    const state = get()
    // Deduplicate: if already fetched or in-flight across ANY hook instance, abort.
    if (
      !force &&
      (state.fetchedIds.includes(tabId) || state.loadingIds[tabId])
    ) {
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
      const prevHash = state.tabContents[tabId]?.extractionDebug?.contentHash
      const nextHash = response?.extractionDebug?.contentHash
      const didChange = !!prevHash && !!nextHash && prevHash !== nextHash

      set((s) => ({
        tabContents: {
          ...s.tabContents,
          [tabId]: {
            html,
            title,
            extractionDebug: response?.extractionDebug
          }
        },
        loadingIds: { ...s.loadingIds, [tabId]: false },
        updatedIds: {
          ...s.updatedIds,
          [tabId]: didChange || !!s.updatedIds[tabId]
        }
      }))
    } catch (err) {
      const errorMessage = getDisplayErrorMessage(err)
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

  clearUpdatedFlag: (tabId) => {
    set((s) => ({
      updatedIds: { ...s.updatedIds, [tabId]: false }
    }))
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
      const nextUpdated = { ...s.updatedIds }
      for (const idStr in nextUpdated) {
        const id = parseInt(idStr, 10)
        if (!currentTabIds.includes(id)) {
          delete nextUpdated[id]
        }
      }

      return contentsChanged || fetchedChanged
        ? {
            tabContents: nextContents,
            fetchedIds: nextFetched,
            updatedIds: nextUpdated
          }
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
  const {
    tabContents,
    loadingIds,
    updatedIds,
    fetchTabContent,
    clearUpdatedFlag,
    cleanupRemovedTabs
  } = useTabFetchingStore()

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

  const [autoRefreshTabContext] = useStorage<boolean>(
    {
      key: STORAGE_KEYS.CHAT.AUTO_REFRESH_TAB_CONTEXT,
      instance: plasmoGlobalStorage
    },
    false
  )

  useEffect(() => {
    if (!autoRefreshTabContext || selectedTabIds.length === 0) return
    const interval = setInterval(() => {
      selectedTabIds
        .map((id) => parseInt(id, 10))
        .forEach((tabId) => {
          fetchTabContent(tabId, getTabTitle(tabId), setErrors, true)
        })
    }, TAB_CONTENT_REFRESH_INTERVAL_MS)

    return () => clearInterval(interval)
  }, [
    autoRefreshTabContext,
    selectedTabIds,
    fetchTabContent,
    getTabTitle,
    setErrors
  ])

  const refreshSelectedTabContents = async () => {
    await Promise.all(
      selectedTabIds.map(async (id) => {
        const tabId = parseInt(id, 10)
        clearUpdatedFlag(tabId)
        await fetchTabContent(tabId, getTabTitle(tabId), setErrors, true)
      })
    )
  }

  return {
    tabContents,
    loadingIds,
    updatedIds,
    errors,
    clearUpdatedFlag,
    refreshSelectedTabContents
  }
}
