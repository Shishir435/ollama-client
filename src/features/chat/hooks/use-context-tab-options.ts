import { AppWindow } from "lucide-react"
import { useCallback, useEffect, useMemo, useState } from "react"
import { useTranslation } from "react-i18next"

import { useOpenTabs } from "@/features/tabs/hooks/use-open-tab"
import { useTabContents } from "@/features/tabs/hooks/use-tab-contents"
import { useTabStatusMap } from "@/features/tabs/hooks/use-tab-status-map"
import { useSelectedTabs } from "@/features/tabs/stores/selected-tabs-store"
import {
  getMatchingPerSiteProfile,
  type PerSiteProfileSettings
} from "@/lib/per-site-profiles"
import { matchesUserPattern } from "@/lib/url-pattern"

interface UseContextTabOptionsArgs {
  tabAccess: boolean
  excludedPatterns: string[]
  perSiteProfileList: PerSiteProfileSettings["profiles"]
}

/**
 * The tab list the Context sheet offers, filtered to what the user has allowed
 * the extension to read, plus the selection state that survives the sheet
 * closing.
 *
 * Selection lives in the shared store, so it can drift out of range whenever the
 * user closes a tab or adds an exclusion while the sheet is shut. The two
 * reconciliation effects below are what keep it honest: one drops selections and
 * a preview that no longer resolve to a readable tab, the other re-adds tabs a
 * per-site profile marks `always`.
 */
export const useContextTabOptions = ({
  tabAccess,
  excludedPatterns,
  perSiteProfileList
}: UseContextTabOptionsArgs) => {
  const { t } = useTranslation()
  const { tabs: openTabs, refreshTabs } = useOpenTabs(tabAccess)
  const { selectedTabIds, setSelectedTabIds } = useSelectedTabs()
  const { tabContents } = useTabContents()
  const getTabStatus = useTabStatusMap()
  const [tabSearch, setTabSearch] = useState("")
  const [previewTabId, setPreviewTabId] = useState<string | null>(null)

  const tabOptions = useMemo(() => {
    const isAccessible = (url: string | undefined) => {
      if (!url) return false
      const matchingProfile = getMatchingPerSiteProfile(url, {
        profiles: perSiteProfileList
      })
      if (matchingProfile?.tabContext === "never") return false
      return !excludedPatterns.some((pattern) =>
        matchesUserPattern(url, pattern)
      )
    }
    return openTabs
      .filter((tab) => tab.id !== undefined && isAccessible(tab.url))
      .map((tab) => ({
        // Full title: the row truncates with CSS so it uses whatever width the
        // sheet has, and the untruncated string feeds search and the tooltip.
        label: tab.title || tab.url || t("tabs.inspector.untitled"),
        value: String(tab.id),
        icon: AppWindow
      }))
  }, [openTabs, t, excludedPatterns, perSiteProfileList])

  const filteredTabOptions = useMemo(() => {
    const query = tabSearch.trim().toLowerCase()
    if (!query) return tabOptions
    return tabOptions.filter((option) => {
      const tabId = parseInt(option.value, 10)
      const content = tabContents[tabId]?.html || ""
      return `${option.label} ${content}`.toLowerCase().includes(query)
    })
  }, [tabContents, tabOptions, tabSearch])

  useEffect(() => {
    const allowedIds = new Set(tabOptions.map((option) => option.value))
    const next = selectedTabIds.filter((id) => allowedIds.has(id))
    if (next.length !== selectedTabIds.length) setSelectedTabIds(next)
    if (previewTabId && !allowedIds.has(previewTabId)) setPreviewTabId(null)
  }, [previewTabId, selectedTabIds, setSelectedTabIds, tabOptions])

  useEffect(() => {
    if (!tabAccess) return
    const alwaysIds = openTabs
      .filter(
        (tab) =>
          tab.id !== undefined &&
          tab.url &&
          getMatchingPerSiteProfile(tab.url, {
            profiles: perSiteProfileList
          })?.tabContext === "always"
      )
      .map((tab) => String(tab.id))
      .filter((id) => tabOptions.some((option) => option.value === id))

    const next = Array.from(new Set([...selectedTabIds, ...alwaysIds]))
    if (next.length !== selectedTabIds.length) setSelectedTabIds(next)
  }, [
    openTabs,
    perSiteProfileList,
    selectedTabIds,
    setSelectedTabIds,
    tabAccess,
    tabOptions
  ])

  const toggleTab = useCallback(
    (value: string) =>
      setSelectedTabIds(
        selectedTabIds.includes(value)
          ? selectedTabIds.filter((id) => id !== value)
          : [...selectedTabIds, value]
      ),
    [selectedTabIds, setSelectedTabIds]
  )

  // Memoized off the already-memoized option list so it is a stable dependency
  // for the callback below.
  const visibleIds = useMemo(
    () => filteredTabOptions.map((option) => option.value),
    [filteredTabOptions]
  )
  const allVisibleSelected =
    visibleIds.length > 0 &&
    visibleIds.every((id) => selectedTabIds.includes(id))

  /**
   * Selects every tab currently listed, or clears them when they are all already
   * selected. Scoped to the visible list rather than every open tab so it stays
   * predictable while a search filter is applied, and it leaves selections that
   * the filter is hiding alone.
   */
  const toggleAllVisible = useCallback(() => {
    if (allVisibleSelected) {
      const visible = new Set(visibleIds)
      setSelectedTabIds(selectedTabIds.filter((id) => !visible.has(id)))
      return
    }
    setSelectedTabIds([...new Set([...selectedTabIds, ...visibleIds])])
  }, [allVisibleSelected, selectedTabIds, setSelectedTabIds, visibleIds])

  const previewTab = previewTabId
    ? tabContents[parseInt(previewTabId, 10)]
    : null

  return {
    filteredTabOptions,
    allVisibleSelected,
    toggleAllVisible,
    tabContents,
    getTabStatus,
    selectedTabIds,
    tabSearch,
    setTabSearch,
    refreshTabs,
    toggleTab,
    previewTabId,
    previewTab,
    openPreview: setPreviewTabId,
    closePreview: useCallback(() => setPreviewTabId(null), [])
  }
}
