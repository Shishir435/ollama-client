import { useStorage } from "@plasmohq/storage/hook"
import { useEffect, useState } from "react"
import { useTranslation } from "react-i18next"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog"
import { MultiSelect } from "@/components/ui/multi-select"
import { useOpenTabs } from "@/features/tabs/hooks/use-open-tab"
import { useTabContents } from "@/features/tabs/hooks/use-tab-contents"
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
  const { t } = useTranslation()
  const [tabAccess] = useStorage<boolean>(
    {
      key: STORAGE_KEYS.BROWSER.TABS_ACCESS,
      instance: plasmoGlobalStorage
    },
    false
  )
  const { tabs: openTabs, refreshTabs } = useOpenTabs(tabAccess)
  const { selectedTabIds, setSelectedTabIds } = useSelectedTabs()
  const { tabContents } = useTabContents()
  const getTabStatus = useTabStatusMap()
  const [showInspector, setShowInspector] = useState(false)

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
    .filter((tab) => tab.id !== undefined && isAccessibleTab(tab.url))
    .map((tab) => ({
      label: trimTitle(tab.title),
      value: String(tab.id)
    }))

  return (
    <div className="space-y-2">
      <MultiSelect
        options={tabOptions}
        onValueChange={setSelectedTabIds}
        onRefresh={refreshTabs}
        defaultValue={selectedTabIds}
        placeholder={t("tabs.select.placeholder")}
        statusForValue={getTabStatus}
      />
      {selectedTabIds.length > 0 && (
        <div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowInspector(true)}>
            View extracted content
          </Button>
          <Dialog open={showInspector} onOpenChange={setShowInspector}>
            <DialogContent className="h-[85vh] max-w-[95vw] w-full p-0 sm:max-w-5xl">
              <DialogHeader className="border-b px-5 py-4">
                <DialogTitle>Extracted Tab Context</DialogTitle>
                <DialogDescription>
                  Review exactly what will be used as tab context before send.
                </DialogDescription>
              </DialogHeader>
              <div className="min-h-0 flex-1 overflow-y-auto p-4">
                <div className="space-y-3">
                  {selectedTabIds.map((id) => {
                    const tabId = parseInt(id, 10)
                    const item = tabContents[tabId]
                    const extractedText = item?.html || ""
                    return (
                      <div key={id} className="rounded-md border bg-muted/20">
                        <div className="border-b bg-background px-3 py-2">
                          <div className="font-medium">
                            {item?.title || "Untitled"}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            chars: {extractedText.length}
                            {item?.extractionDebug?.scraper
                              ? ` | scraper: ${item.extractionDebug.scraper}`
                              : ""}
                          </div>
                        </div>
                        <div className="max-h-[42vh] overflow-auto p-3">
                          <pre className="whitespace-pre-wrap break-words text-xs leading-relaxed text-foreground">
                            {extractedText || "(No extracted content yet)"}
                          </pre>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            </DialogContent>
          </Dialog>
        </div>
      )}
    </div>
  )
}
