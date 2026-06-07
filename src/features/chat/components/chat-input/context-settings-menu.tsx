import { useStorage } from "@plasmohq/storage/hook"
import {
  AppWindow,
  CheckIcon,
  Database,
  Eye,
  Loader2,
  RefreshCw,
  Search,
  ShieldCheck
} from "lucide-react"
import { useEffect, useMemo, useState } from "react"
import { useTranslation } from "react-i18next"
import { TooltipActionButton } from "@/components/actions"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import {
  Popover,
  PopoverContent,
  PopoverTrigger
} from "@/components/ui/popover"
import { ScrollArea } from "@/components/ui/scroll-area"
import { useOpenTabs } from "@/features/tabs/hooks/use-open-tab"
import { useTabContents } from "@/features/tabs/hooks/use-tab-contents"
import { useTabStatusMap } from "@/features/tabs/hooks/use-tab-status-map"
import { useSelectedTabs } from "@/features/tabs/stores/selected-tabs-store"
import { DEFAULT_EXCLUDE_URLS, STORAGE_KEYS } from "@/lib/constants"
import { Layers } from "@/lib/lucide-icon"
import { plasmoGlobalStorage } from "@/lib/plasmo-global-storage"
import { cn } from "@/lib/utils"
import type { ContentExtractionConfig } from "@/types"

const trimTitle = (title: string, max = 38) =>
  title ? (title.length > max ? `${title.slice(0, max)}...` : title) : ""

const trimPreview = (text: string, max = 140) => {
  const compact = text.replace(/\s+/g, " ").trim()
  return compact.length > max ? `${compact.slice(0, max)}...` : compact
}

export const ContextSettingsMenu = () => {
  const { t } = useTranslation()
  const [useRAG, setUseRAG] = useStorage<boolean>(
    {
      key: STORAGE_KEYS.EMBEDDINGS.USE_RAG,
      instance: plasmoGlobalStorage
    },
    true
  )
  const [tabAccess, setTabAccess] = useStorage<boolean>(
    {
      key: STORAGE_KEYS.BROWSER.TABS_ACCESS,
      instance: plasmoGlobalStorage
    },
    false
  )
  const { tabs: openTabs, refreshTabs } = useOpenTabs(Boolean(tabAccess))
  const { selectedTabIds, setSelectedTabIds } = useSelectedTabs()
  const { tabContents } = useTabContents()
  const getTabStatus = useTabStatusMap()
  const [open, setOpen] = useState(false)
  const [previewTabId, setPreviewTabId] = useState<string | null>(null)
  const [tabSearch, setTabSearch] = useState("")
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
  const [groundedOnlyMode, setGroundedOnlyMode] = useStorage<boolean>(
    {
      key: STORAGE_KEYS.CHAT.GROUNDED_ONLY_MODE,
      instance: plasmoGlobalStorage
    },
    false
  )

  const excludedPatterns =
    config?.excludedUrlPatterns || oldPatterns || DEFAULT_EXCLUDE_URLS

  const tabOptions = useMemo(() => {
    const isAccessibleTab = (url: string | undefined) => {
      if (!url) return false
      return !excludedPatterns.some((pattern) => {
        try {
          return new RegExp(pattern).test(url)
        } catch {
          return url.includes(pattern)
        }
      })
    }

    return openTabs
      .filter((tab) => tab.id !== undefined && isAccessibleTab(tab.url))
      .map((tab) => ({
        label: trimTitle(tab.title || tab.url || t("tabs.inspector.untitled")),
        value: String(tab.id),
        icon: AppWindow
      }))
  }, [openTabs, t, excludedPatterns])

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
    const nextSelected = selectedTabIds.filter((id) => allowedIds.has(id))
    if (nextSelected.length !== selectedTabIds.length) {
      setSelectedTabIds(nextSelected)
    }
    if (previewTabId && !allowedIds.has(previewTabId)) {
      setPreviewTabId(null)
    }
  }, [previewTabId, selectedTabIds, setSelectedTabIds, tabOptions])

  const toggleActions = [
    {
      key: "page",
      checked: tabAccess,
      onClick: () => setTabAccess(!tabAccess),
      icon: AppWindow,
      label: tabAccess ? t("tabs.toggle.label_on") : t("tabs.toggle.label_off")
    },
    {
      key: "rag",
      checked: useRAG,
      onClick: () => setUseRAG(!useRAG),
      icon: Database,
      label: useRAG
        ? t("chat.input.rag_toggle_on")
        : t("chat.input.rag_toggle_off")
    },
    {
      key: "grounded",
      checked: groundedOnlyMode,
      onClick: () => setGroundedOnlyMode(!groundedOnlyMode),
      icon: ShieldCheck,
      label: t("settings.grounding_mode.label")
    }
  ]

  const toggleTab = (value: string) => {
    setSelectedTabIds(
      selectedTabIds.includes(value)
        ? selectedTabIds.filter((id) => id !== value)
        : [...selectedTabIds, value]
    )
  }
  const previewTab = previewTabId
    ? tabContents[parseInt(previewTabId, 10)]
    : null
  const previewContent = previewTab?.html?.trim()
  const previewCharCount = previewContent?.length ?? 0
  const openPreview = (value: string) => {
    setPreviewTabId(value)
    setOpen(false)
  }

  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <TooltipActionButton
          trigger={
            <PopoverTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-8 rounded-control text-muted-foreground hover:bg-muted/55 hover:text-foreground"
                  aria-label={t("tabs.context")}
                />
              }
            />
          }
          label={t("tabs.context")}
          icon={<Layers className="icon-md" />}
        />
        <PopoverContent
          align="end"
          sideOffset={8}
          className="max-h-[min(36rem,calc(100vh-8rem))] w-[min(20rem,calc(100vw-1.25rem))] max-w-[calc(100vw-1.25rem)] gap-3 overflow-y-auto rounded-panel p-2.5">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
              <Layers className="icon-xs" />
              {t("tabs.context")}
            </div>
          </div>

          <div className="grid gap-1">
            {toggleActions.map((action) => {
              const Icon = action.icon
              return (
                <Button
                  key={action.key}
                  type="button"
                  variant="ghost"
                  className={cn(
                    "h-8 justify-start gap-2 rounded-control px-2 text-xs",
                    action.checked
                      ? "bg-muted/55 text-foreground"
                      : "text-muted-foreground"
                  )}
                  onClick={action.onClick}>
                  <Icon className="icon-sm shrink-0" />
                  <span className="min-w-0 flex-1 truncate text-left">
                    {action.label}
                  </span>
                  {action.checked && (
                    <CheckIcon className="icon-sm shrink-0 text-app-primary" />
                  )}
                </Button>
              )
            })}
          </div>

          {tabAccess && (
            <div className="grid gap-2 border-t border-border/40 pt-2">
              <div className="flex items-center justify-between gap-2 text-[11px] font-medium text-muted-foreground">
                <span>{t("tabs.select.placeholder")}</span>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-6 rounded-control"
                  onClick={refreshTabs}
                  aria-label={t("tabs.select.refresh_now")}>
                  <RefreshCw className="icon-xs" />
                </Button>
              </div>
              <div className="relative">
                <Search className="-translate-y-1/2 pointer-events-none absolute top-1/2 left-2 icon-sm text-muted-foreground" />
                <Input
                  value={tabSearch}
                  onChange={(event) => setTabSearch(event.target.value)}
                  placeholder={t("tabs.select.search_placeholder")}
                  className="h-7 rounded-control pl-7 text-xs"
                  aria-label={t("tabs.select.search_placeholder")}
                />
              </div>
              <ScrollArea className="max-h-36 rounded-control border border-border/35 bg-background/35">
                <div className="grid gap-1 p-1">
                  {filteredTabOptions.map((option) => {
                    const tabId = parseInt(option.value, 10)
                    const item = tabContents[tabId]
                    const content = item?.html?.trim()
                    const status = getTabStatus(option.value)
                    const isSelected = selectedTabIds.includes(option.value)

                    return (
                      <div
                        key={option.value}
                        className={cn(
                          "grid min-w-0 gap-1 rounded-control px-2 py-1.5 text-left text-xs transition-colors",
                          isSelected
                            ? "bg-muted/55 text-foreground"
                            : "text-muted-foreground hover:bg-muted/35 hover:text-foreground"
                        )}>
                        <span className="flex min-w-0 items-center gap-1.5">
                          <AppWindow className="icon-sm shrink-0" />
                          <button
                            type="button"
                            className="min-w-0 flex-1 truncate text-left font-medium"
                            onClick={() => toggleTab(option.value)}
                            title={option.label}>
                            {option.label}
                          </button>
                          {status.loading && (
                            <Loader2 className="icon-xs shrink-0 animate-spin" />
                          )}
                          {isSelected && !status.loading && (
                            <CheckIcon className="icon-xs shrink-0 text-app-primary" />
                          )}
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="size-5 rounded-control text-muted-foreground hover:text-foreground"
                            onClick={() => openPreview(option.value)}
                            aria-label={t("tabs.select.view_content")}>
                            <Eye className="icon-xs" />
                          </Button>
                        </span>
                        <Button
                          type="button"
                          variant="secondary"
                          className="overflow-hidden text-start"
                          onClick={() => openPreview(option.value)}>
                          {content
                            ? trimPreview(content)
                            : t("tabs.inspector.no_content")}
                        </Button>
                      </div>
                    )
                  })}
                  {filteredTabOptions.length === 0 && (
                    <p className="px-2 py-1.5 text-xs text-muted-foreground">
                      {t("tabs.inspector.no_content")}
                    </p>
                  )}
                </div>
              </ScrollArea>
            </div>
          )}
        </PopoverContent>
      </Popover>
      <Dialog
        open={Boolean(previewTabId)}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) setPreviewTabId(null)
        }}>
        <DialogContent className="max-h-[min(80vh,40rem)] w-[min(42rem,calc(100vw-2rem))] max-w-[calc(100vw-2rem)] gap-0 overflow-hidden rounded-panel p-0 sm:max-w-[min(42rem,calc(100vw-2rem))]">
          <DialogHeader className="min-w-0 border-b border-border/35 px-4 py-3">
            <DialogTitle className="truncate pr-8">
              {previewTab?.title || t("tabs.inspector.untitled")}
            </DialogTitle>
            <DialogDescription>
              {t("tabs.inspector.chars", { count: previewCharCount })}
            </DialogDescription>
          </DialogHeader>
          <ScrollArea className="max-h-[min(64vh,32rem)] overflow-x-hidden">
            <pre className="whitespace-pre-wrap wrap-break-word p-4 font-sans text-xs leading-relaxed text-muted-foreground">
              {previewContent || t("tabs.inspector.no_content")}
            </pre>
          </ScrollArea>
        </DialogContent>
      </Dialog>
    </>
  )
}
