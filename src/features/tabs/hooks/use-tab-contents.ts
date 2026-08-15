import { useCallback, useEffect } from "react"
import { create } from "zustand"
import { useOpenTabs } from "@/features/tabs/hooks/use-open-tab"
import {
  useSelectedTabs,
  useSelectedTabsStore
} from "@/features/tabs/stores/selected-tabs-store"
import { useSetting } from "@/hooks/use-setting"
import {
  blockedTabAccessMessage,
  isContentScriptReadableUrl
} from "@/lib/browser-tab-access"
import { TAB_CONTENT_REFRESH_INTERVAL_MS } from "@/lib/constants"
import { getDisplayErrorMessage } from "@/lib/error-display"
import { SETTINGS } from "@/lib/storage/settings"
import { requestPageContentWithRecovery } from "@/lib/tools/internal/tab-utils"
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
    tabUrl: string | undefined,
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

  fetchTabContent: async (
    tabId,
    fallbackTitle,
    tabUrl,
    setErrors,
    force = false
  ) => {
    const state = get()
    // An in-flight extraction is not a cache, so `force` does not override it:
    // it means "ignore the cached signature", never "scroll and re-read a page
    // that is already being scrolled and read".
    if (state.loadingIds[tabId]) return
    // Deduplicate: if already fetched across ANY hook instance, abort.
    if (!force && state.fetchedIds.includes(tabId)) return

    if (tabUrl && !isContentScriptReadableUrl(tabUrl)) {
      setErrors((prev) => ({
        ...prev,
        [tabId]: blockedTabAccessMessage(`"${fallbackTitle || "this tab"}"`)
      }))
      return
    }

    set((s) => ({
      fetchedIds: s.fetchedIds.includes(tabId)
        ? s.fetchedIds
        : [...s.fetchedIds, tabId],
      loadingIds: { ...s.loadingIds, [tabId]: true }
    }))

    try {
      // Recovers from "Receiving end does not exist" (stale tab from before the
      // extension loaded) by injecting the content script and retrying once.
      const response = await requestPageContentWithRecovery(tabId)

      const html = response?.html || ""
      const title = response?.title || fallbackTitle || "Untitled"
      const previous = get().tabContents[tabId]
      const prevHash = previous?.extractionDebug?.contentHash
      const nextHash = response?.extractionDebug?.contentHash
      const didChange = !!prevHash && !!nextHash && prevHash !== nextHash

      // Same hash, same title: the page did not change, so keep the entry we
      // already hold. Rewriting it would hand every consumer a new object and
      // rebuild the whole tab context for content that is byte-identical.
      if (
        previous &&
        prevHash &&
        prevHash === nextHash &&
        previous.title === title
      ) {
        set((s) => ({ loadingIds: { ...s.loadingIds, [tabId]: false } }))
        return
      }

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
      // Raw Chrome messaging errors ("Could not establish connection.
      // Receiving end does not exist.") read like a crash; this string ends up
      // in the model's context, so keep it calm and actionable instead.
      const raw = getDisplayErrorMessage(err)
      const errorMessage =
        /receiving end does not exist|could not establish connection/i.test(raw)
          ? `Can't read "${fallbackTitle || "this tab"}" right now — reload that tab and refresh the context.`
          : raw
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

/**
 * Auto-refresh runs on ONE module-level timer, not one per mounted hook.
 *
 * `useTabContents` has several simultaneous consumers, and a timer in the hook
 * body meant N of them scheduled N sweeps — each of which scrolls the host page
 * and holds a document-wide MutationObserver. Subscribers are reference
 * counted: the timer starts with the first and stops with the last.
 */
let autoRefreshSubscribers = 0
let autoRefreshTimer: ReturnType<typeof setInterval> | null = null

/**
 * Latest known title/url per tab. Every consumer reads the same `useOpenTabs`
 * data, so the sweep can take it from here instead of from whichever hook
 * instance happened to register the timer.
 */
let knownTabs: Record<number, { title?: string; url?: string }> = {}

/**
 * Overrun is guarded per tab, not per sweep.
 *
 * `fetchTabContent` already returns early while a tab has an extraction in
 * flight, and `force` cannot bypass that — which is the whole of what stacking
 * protection needs, since each tab's extraction is independent.
 *
 * A single global in-flight flag looked equivalent and was not: one tab whose
 * extraction never settles (the transcript fetch has no timeout) would hold the
 * flag forever, and every later sweep would skip *every* selected tab until the
 * extension context reloaded. Scoped to the tab, a hung extraction blocks only
 * the tab it belongs to.
 */
const runAutoRefreshSweep = () => {
  if (typeof document !== "undefined" && document.hidden) return

  const { selectedTabIds, setErrors } = useSelectedTabsStore.getState()
  if (selectedTabIds.length === 0) return

  const { fetchTabContent } = useTabFetchingStore.getState()
  for (const id of selectedTabIds) {
    const tabId = parseInt(id, 10)
    const known = knownTabs[tabId]
    void fetchTabContent(tabId, known?.title || "", known?.url, setErrors, true)
  }
}

const handleAutoRefreshVisibility = () => {
  if (!document.hidden) runAutoRefreshSweep()
}

const subscribeAutoRefresh = (): (() => void) => {
  autoRefreshSubscribers += 1
  if (autoRefreshSubscribers === 1) {
    autoRefreshTimer = setInterval(
      runAutoRefreshSweep,
      TAB_CONTENT_REFRESH_INTERVAL_MS
    )
    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", handleAutoRefreshVisibility)
    }
  }

  let released = false
  return () => {
    if (released) return
    released = true
    autoRefreshSubscribers = Math.max(0, autoRefreshSubscribers - 1)
    if (autoRefreshSubscribers > 0) return
    if (autoRefreshTimer) {
      clearInterval(autoRefreshTimer)
      autoRefreshTimer = null
    }
    if (typeof document !== "undefined") {
      document.removeEventListener(
        "visibilitychange",
        handleAutoRefreshVisibility
      )
    }
  }
}

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

  const [tabAccess] = useSetting(SETTINGS.TABS_ACCESS)

  const { tabs: openTabs } = useOpenTabs(tabAccess)

  const getTabTitle = useCallback(
    (tabId: number) => {
      const tab = openTabs.find((tab) => tab.id === tabId)?.title
      return tab || ""
    },
    [openTabs]
  )

  const getTabUrl = useCallback(
    (tabId: number) => {
      return openTabs.find((tab) => tab.id === tabId)?.url
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
      fetchTabContent(tabId, getTabTitle(tabId), getTabUrl(tabId), setErrors)
    })
  }, [selectedTabIds, getTabTitle, getTabUrl, fetchTabContent, setErrors])

  const [autoRefreshTabContext] = useSetting(SETTINGS.AUTO_REFRESH_TAB_CONTEXT)

  useEffect(() => {
    const next: Record<number, { title?: string; url?: string }> = {}
    for (const tab of openTabs) {
      if (tab.id === undefined) continue
      next[tab.id] = { title: tab.title, url: tab.url }
    }
    knownTabs = next
  }, [openTabs])

  /*
   * Deliberately keyed on the setting alone. The sweep reads the current
   * selection and the current tab titles from module state, so a selection
   * change must not tear the shared timer down and restart its interval.
   */
  useEffect(() => {
    if (!autoRefreshTabContext) return
    return subscribeAutoRefresh()
  }, [autoRefreshTabContext])

  const refreshSelectedTabContents = async () => {
    await Promise.all(
      selectedTabIds.map(async (id) => {
        const tabId = parseInt(id, 10)
        clearUpdatedFlag(tabId)
        await fetchTabContent(
          tabId,
          getTabTitle(tabId),
          getTabUrl(tabId),
          setErrors,
          true
        )
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
