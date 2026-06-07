import { useStorage } from "@plasmohq/storage/hook"
import { useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import { type ActionConfig, ActionGroup } from "@/components/actions"
import { MultiSelect } from "@/components/multi-select"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog"
import { useOpenTabs } from "@/features/tabs/hooks/use-open-tab"
import { useTabContents } from "@/features/tabs/hooks/use-tab-contents"
import { useTabStatusMap } from "@/features/tabs/hooks/use-tab-status-map"
import { useSelectedTabs } from "@/features/tabs/stores/selected-tabs-store"
import { DEFAULT_EXCLUDE_URLS, STORAGE_KEYS } from "@/lib/constants"
import { Eye, RefreshCw } from "@/lib/lucide-icon"
import { plasmoGlobalStorage } from "@/lib/plasmo-global-storage"
import { STATUS_STYLES } from "@/lib/ui-status"
import { cn } from "@/lib/utils"
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
  const { tabContents, updatedIds, refreshSelectedTabContents } =
    useTabContents()
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

  const selectedCount = selectedTabIds.length
  const updatedSelectedCount = selectedTabIds.filter(
    (id) => updatedIds[parseInt(id, 10)]
  ).length
  const selectedTabActions: ActionConfig[] = [
    {
      key: "view-content",
      variant: "outline",
      size: "icon",
      className: "size-7",
      onClick: () => setShowInspector(true),
      label: t("tabs.select.view_content"),
      icon: <Eye className="icon-md" />
    },
    {
      key: "refresh",
      variant: "outline",
      size: "icon",
      className: "size-7",
      onClick: refreshSelectedTabContents,
      label: t("tabs.select.refresh_now"),
      icon: <RefreshCw className="icon-md" />
    }
  ]

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
        <div className="rounded-lg border bg-background/40 px-3 py-2">
          <div className="flex items-center justify-between gap-2">
            <p className="truncate text-sm font-medium">
              {t("tabs.select.ready", {
                selected: selectedCount,
                total: selectedCount
              })}
            </p>
            <div className="flex items-center gap-1.5">
              {updatedSelectedCount > 0 && (
                <span
                  className={cn(
                    "shrink-0 rounded-full px-2 py-1 text-[10px] font-semibold",
                    STATUS_STYLES.warning.bgSoft,
                    STATUS_STYLES.warning.text
                  )}>
                  {t("tabs.select.updated")}
                </span>
              )}
              <ActionGroup actions={selectedTabActions} className="gap-1.5" />
            </div>
          </div>

          <Dialog open={showInspector} onOpenChange={setShowInspector}>
            <DialogContent className="h-[85vh] max-w-[95vw] w-full p-0 sm:max-w-5xl">
              <DialogHeader className="border-b px-5 py-3">
                <DialogTitle className="text-base">
                  {t("tabs.inspector.title")}
                </DialogTitle>
                <DialogDescription className="text-sm">
                  {t("tabs.inspector.description")}
                </DialogDescription>
              </DialogHeader>
              <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
                <div className="flex-1 overflow-y-auto p-4">
                  <div className="grid gap-4">
                    {selectedTabIds.map((id) => {
                      const tabId = parseInt(id, 10)
                      const item = tabContents[tabId]
                      const extractedText = item?.html || ""
                      const reliabilityScore =
                        typeof item?.extractionDebug?.reliabilityScore ===
                        "number"
                          ? item.extractionDebug.reliabilityScore
                          : null
                      const isLowReliability =
                        reliabilityScore !== null && reliabilityScore < 0.35

                      return (
                        <div
                          key={id}
                          className="overflow-hidden rounded-lg border bg-card">
                          <div className="flex items-start justify-between border-b px-4 py-3">
                            <div className="min-w-0 flex-1">
                              <div className="truncate font-medium text-foreground">
                                {item?.title || t("tabs.inspector.untitled")}
                              </div>
                              <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                                <span className="shrink-0">
                                  {t("tabs.inspector.chars", {
                                    count: extractedText.length
                                  })}
                                </span>
                                {item?.extractionDebug?.scraper && (
                                  <span className="shrink-0 font-mono text-foreground/70">
                                    {item.extractionDebug.scraper}
                                  </span>
                                )}
                                {item?.extractionDebug?.profile && (
                                  <span className="shrink-0 font-mono text-foreground/70">
                                    {item.extractionDebug.profile}
                                  </span>
                                )}
                                {reliabilityScore !== null && (
                                  <span
                                    className={cn(
                                      "shrink-0 font-medium",
                                      reliabilityScore >= 0.7
                                        ? STATUS_STYLES.success.text
                                        : reliabilityScore >= 0.35
                                          ? STATUS_STYLES.warning.text
                                          : STATUS_STYLES.danger.text
                                    )}>
                                    {t("tabs.inspector.reliable", {
                                      percent: Math.round(
                                        reliabilityScore * 100
                                      )
                                    })}
                                  </span>
                                )}
                              </div>
                            </div>
                          </div>
                          {isLowReliability && (
                            <div
                              className={cn(
                                "border-b px-4 py-2",
                                STATUS_STYLES.warning.bgSoft
                              )}>
                              <p
                                className={cn(
                                  "text-xs",
                                  STATUS_STYLES.warning.softText
                                )}>
                                {t("tabs.inspector.low_reliability")}
                              </p>
                            </div>
                          )}
                          <div className="max-h-[35vh] overflow-auto bg-muted/30 p-4">
                            <pre className="whitespace-pre-wrap break-all font-mono text-xs leading-relaxed text-foreground/80">
                              {extractedText || t("tabs.inspector.no_content")}
                            </pre>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              </div>
            </DialogContent>
          </Dialog>
        </div>
      )}
    </div>
  )
}
