import { useStorage } from "@plasmohq/storage/hook"
import { useEffect, useState } from "react"
import { MultiSelect } from "@/components/ui/multi-select"
import { useOpenTabs } from "@/features/tabs/hooks/use-open-tab"
import { useTabStatusMap } from "@/features/tabs/hooks/use-tab-status-map"
import { useSelectedTabs } from "@/features/tabs/stores/selected-tabs-store"
import { DEFAULT_EXCLUDE_URLS, STORAGE_KEYS } from "@/lib/constants"
import { plasmoGlobalStorage } from "@/lib/plasmo-global-storage"
import type { ContentExtractionConfig } from "@/types"

const trimTitle = (title: string, max = 25) =>
  title
    ? title.length > max
      ? `${title.slice(0, max)}...`
      : title
    : "undefined"

export const TabsSelect = () => {
  const [tabAccess] = useStorage<boolean>(
    {
      key: STORAGE_KEYS.BROWSER.TABS_ACCESS,
      instance: plasmoGlobalStorage
    },
    false
  )
  const { tabs: openTabs, refreshTabs } = useOpenTabs(tabAccess)
  const { selectedTabIds, setSelectedTabIds } = useSelectedTabs()
  const getTabStatus = useTabStatusMap()

  // Get excluded patterns from new config, fallback to old storage
  const [config] = useStorage<ContentExtractionConfig>(
    {
      key: STORAGE_KEYS.BROWSER.CONTENT_EXTRACTION_CONFIG,
      instance: plasmoGlobalStorage
    },
    null
  )
  const [oldPatterns] = useStorage<string[]>(
    {
      key: STORAGE_KEYS.BROWSER.EXCLUDE_URL_PATTERNS,
      instance: plasmoGlobalStorage
    },
    DEFAULT_EXCLUDE_URLS
  )

  const [excludedPatterns, setExcludedPatterns] =
    useState<string[]>(DEFAULT_EXCLUDE_URLS)

  useEffect(() => {
    // Use patterns from new config if available, otherwise fallback to old storage
    const patterns =
      config?.excludedUrlPatterns || oldPatterns || DEFAULT_EXCLUDE_URLS
    setExcludedPatterns(patterns)
  }, [config, oldPatterns])

  if (!tabAccess) return null

  const isAccessibleTab = (url: string | undefined) => {
    if (!url) return false
    return !excludedPatterns?.some((pattern) => {
      try {
        return new RegExp(pattern).test(url)
      } catch {
        return url.includes(pattern)
      }
    })
  }

  const tabOptions = openTabs
    .filter((tab) => isAccessibleTab(tab.url))
    .map((tab) => ({
      label: trimTitle(tab.title),
      value: tab.id?.toString() || tab.title
    }))

  return (
    <div className="mb-2 w-full">
      <MultiSelect
        options={tabOptions}
        onValueChange={setSelectedTabIds}
        onRefresh={refreshTabs}
        defaultValue={selectedTabIds}
        placeholder="Select open tabs"
        statusForValue={getTabStatus}
      />
    </div>
  )
}
