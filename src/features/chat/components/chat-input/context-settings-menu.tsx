import { useStorage } from "@plasmohq/storage/hook"
import {
  AppWindow,
  BrainCircuit,
  Camera,
  CheckIcon,
  Eye,
  Loader2,
  Lock,
  RefreshCw,
  Search,
  ShieldCheck
} from "lucide-react"
import { useEffect, useMemo, useState } from "react"
import { useTranslation } from "react-i18next"
import { TooltipActionButton } from "@/components/actions"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Popover,
  PopoverContent,
  PopoverTrigger
} from "@/components/ui/popover"
import { ScrollArea } from "@/components/ui/scroll-area"
import { useSelectedModelCapabilities } from "@/features/model/hooks/use-selected-model-capabilities"
import { PermissionsSheet } from "@/features/permissions/components/permissions-sheet"
import { useOpenTabs } from "@/features/tabs/hooks/use-open-tab"
import { useTabContents } from "@/features/tabs/hooks/use-tab-contents"
import { useTabStatusMap } from "@/features/tabs/hooks/use-tab-status-map"
import { useSelectedTabs } from "@/features/tabs/stores/selected-tabs-store"
import { useWebSearchConfig } from "@/features/web-search/stores/web-search-config-store"
import {
  DEFAULT_CONTENT_EXTRACTION_CONFIG,
  DEFAULT_EXCLUDE_URLS,
  DEFAULT_TABS_ACCESS,
  STORAGE_KEYS
} from "@/lib/constants"
import { Layers } from "@/lib/lucide-icon"
import {
  DEFAULT_PER_SITE_PROFILE_SETTINGS,
  getMatchingPerSiteProfile,
  type PerSiteProfileSettings
} from "@/lib/per-site-profiles"
import { plasmoGlobalStorage } from "@/lib/plasmo-global-storage"
import { cn } from "@/lib/utils"
import type { ContentExtractionConfig } from "@/types"
import { CopyButton } from "../copy-button"
import { PreviewSheet, PreviewTextBlock } from "../preview-sheet"

const trimTitle = (title: string, max = 38) =>
  title ? (title.length > max ? `${title.slice(0, max)}...` : title) : ""

const trimPreview = (text: string, max = 140) => {
  const compact = text.replace(/\s+/g, " ").trim()
  return compact.length > max ? `${compact.slice(0, max)}...` : compact
}

const EMPTY_PROFILE_LIST: PerSiteProfileSettings["profiles"] = []

interface TabOptionRowProps {
  option: { value: string; label: string }
  content: string | undefined
  isSelected: boolean
  isLoading: boolean
  onToggle: () => void
  onPreview: () => void
}

const TabOptionRow = ({
  option,
  content,
  isSelected,
  isLoading,
  onToggle,
  onPreview
}: TabOptionRowProps) => {
  const { t } = useTranslation()
  return (
    <div
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
          onClick={onToggle}
          title={option.label}>
          {option.label}
        </button>
        {isLoading && <Loader2 className="icon-xs shrink-0 animate-spin" />}
        {isSelected && !isLoading && (
          <CheckIcon className="icon-xs shrink-0 text-app-primary" />
        )}
        <TooltipActionButton
          type="button"
          variant="ghost"
          size="icon"
          className="size-5 rounded-control text-muted-foreground hover:text-foreground"
          onClick={onPreview}
          label={t("tabs.select.view_content")}
          icon={<Eye className="icon-xs" />}
        />
      </span>
      <Button
        type="button"
        variant="secondary"
        className="overflow-hidden text-start"
        onClick={onPreview}>
        {content ? trimPreview(content) : t("tabs.inspector.no_content")}
      </Button>
    </div>
  )
}

interface TabContextPanelProps {
  filteredTabOptions: { value: string; label: string }[]
  tabContents: Record<number, { html?: string; title?: string } | undefined>
  getTabStatus: (id: string) => { loading: boolean }
  selectedTabIds: string[]
  tabSearch: string
  setTabSearch: (v: string) => void
  refreshTabs: () => void
  toggleTab: (id: string) => void
  openPreview: (id: string) => void
}

const TabContextPanel = ({
  filteredTabOptions,
  tabContents,
  getTabStatus,
  selectedTabIds,
  tabSearch,
  setTabSearch,
  refreshTabs,
  toggleTab,
  openPreview
}: TabContextPanelProps) => {
  const { t } = useTranslation()
  return (
    <div className="grid gap-2 border-t border-border/40 pt-2">
      <div className="flex items-center justify-between gap-2 text-2xs font-medium text-muted-foreground">
        <span>{t("tabs.select.placeholder")}</span>
        <TooltipActionButton
          type="button"
          variant="ghost"
          size="icon"
          className="size-6 rounded-control"
          onClick={refreshTabs}
          label={t("tabs.select.refresh_now")}
          icon={<RefreshCw className="icon-xs" />}
        />
      </div>
      <div className="relative">
        <Search className="-translate-y-1/2 pointer-events-none absolute top-1/2 left-2 icon-sm text-muted-foreground" />
        <Input
          value={tabSearch}
          onChange={(e) => setTabSearch(e.target.value)}
          placeholder={t("tabs.select.search_placeholder")}
          className="h-7 rounded-control pl-7 text-xs"
          aria-label={t("tabs.select.search_placeholder")}
        />
      </div>
      <ScrollArea className="max-h-36 rounded-control border border-border/35 bg-background/35">
        <div className="grid gap-1 p-1">
          {filteredTabOptions.map((option) => {
            const tabId = parseInt(option.value, 10)
            const content = tabContents[tabId]?.html?.trim()
            const status = getTabStatus(option.value)
            return (
              <TabOptionRow
                key={option.value}
                option={option}
                content={content}
                isSelected={selectedTabIds.includes(option.value)}
                isLoading={status.loading}
                onToggle={() => toggleTab(option.value)}
                onPreview={() => openPreview(option.value)}
              />
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
  )
}

export const ContextSettingsMenu = ({
  attachmentCount = 0
}: {
  attachmentCount?: number
}) => {
  const { t } = useTranslation()
  const [useRAG, setUseRAG] = useStorage<boolean>(
    { key: STORAGE_KEYS.EMBEDDINGS.USE_RAG, instance: plasmoGlobalStorage },
    true
  )
  const [tabAccess, setTabAccess] = useStorage<boolean>(
    { key: STORAGE_KEYS.BROWSER.TABS_ACCESS, instance: plasmoGlobalStorage },
    DEFAULT_TABS_ACCESS
  )
  const { tabs: openTabs, refreshTabs } = useOpenTabs(Boolean(tabAccess))
  const { selectedTabIds, setSelectedTabIds } = useSelectedTabs()
  const { tabContents } = useTabContents()
  const getTabStatus = useTabStatusMap()
  const [open, setOpen] = useState(false)
  const [permsOpen, setPermsOpen] = useState(false)
  const [previewTabId, setPreviewTabId] = useState<string | null>(null)
  const [tabSearch, setTabSearch] = useState("")
  const [config] = useStorage<ContentExtractionConfig>(
    {
      key: STORAGE_KEYS.BROWSER.CONTENT_EXTRACTION_CONFIG,
      instance: plasmoGlobalStorage
    },
    DEFAULT_CONTENT_EXTRACTION_CONFIG
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
  const [perSiteProfiles] = useStorage<PerSiteProfileSettings>(
    {
      key: STORAGE_KEYS.BROWSER.PER_SITE_PROFILES,
      instance: plasmoGlobalStorage
    },
    DEFAULT_PER_SITE_PROFILE_SETTINGS
  )
  const perSiteProfileList = perSiteProfiles?.profiles ?? EMPTY_PROFILE_LIST

  const [autoScreenshotOnVision, setAutoScreenshotOnVision] =
    useStorage<boolean>(
      {
        key: STORAGE_KEYS.CHAT.AUTO_SCREENSHOT_ON_VISION,
        instance: plasmoGlobalStorage
      },
      false
    )
  const { capabilities, isResolving } = useSelectedModelCapabilities()
  const { config: webSearchConfig, updateConfig: updateWebSearchConfig } =
    useWebSearchConfig()
  const showAutoScreenshot = capabilities?.vision ?? false
  const showWebSearch = Boolean(capabilities?.toolCalling) || isResolving

  const excludedPatterns =
    config?.excludedUrlPatterns || oldPatterns || DEFAULT_EXCLUDE_URLS

  const tabOptions = useMemo(() => {
    const isAccessible = (url: string | undefined) => {
      if (!url) return false
      const matchingProfile = getMatchingPerSiteProfile(url, {
        profiles: perSiteProfileList
      })
      if (matchingProfile?.tabContext === "never") return false
      return !excludedPatterns.some((p) => {
        try {
          return new RegExp(p).test(url)
        } catch {
          return url.includes(p)
        }
      })
    }
    return openTabs
      .filter((tab) => tab.id !== undefined && isAccessible(tab.url))
      .map((tab) => ({
        label: trimTitle(tab.title || tab.url || t("tabs.inspector.untitled")),
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
    const allowedIds = new Set(tabOptions.map((o) => o.value))
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

  const toggleTab = (value: string) =>
    setSelectedTabIds(
      selectedTabIds.includes(value)
        ? selectedTabIds.filter((id) => id !== value)
        : [...selectedTabIds, value]
    )

  const openPreview = (value: string) => {
    setPreviewTabId(value)
    setOpen(false)
  }

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
      icon: BrainCircuit,
      label: useRAG
        ? t("chat.input.rag_toggle_on")
        : t("chat.input.rag_toggle_off")
    },
    ...(showWebSearch
      ? [
          {
            key: "web",
            checked: webSearchConfig.enabled,
            onClick: () =>
              updateWebSearchConfig({ enabled: !webSearchConfig.enabled }),
            icon: Search,
            label: t("chat.context.web")
          }
        ]
      : []),
    {
      key: "grounded",
      checked: groundedOnlyMode,
      onClick: () => setGroundedOnlyMode(!groundedOnlyMode),
      icon: ShieldCheck,
      label: t("settings.grounding_mode.label")
    },
    ...(showAutoScreenshot
      ? [
          {
            key: "auto-screenshot",
            checked: autoScreenshotOnVision,
            onClick: () => setAutoScreenshotOnVision(!autoScreenshotOnVision),
            icon: Camera,
            label: t("chat.input.auto_screenshot")
          }
        ]
      : [])
  ]

  const previewTab = previewTabId
    ? tabContents[parseInt(previewTabId, 10)]
    : null
  const previewContent = previewTab?.html?.trim()
  const previewCharCount = previewContent?.length ?? 0
  const contextState = [
    tabAccess
      ? selectedTabIds.length > 0
        ? t("chat.context.tabs", { count: selectedTabIds.length })
        : t("chat.context.page")
      : null,
    attachmentCount > 0
      ? t("chat.context.files", { count: attachmentCount })
      : useRAG
        ? t("chat.context.knowledge")
        : null,
    showWebSearch && webSearchConfig.enabled ? t("chat.context.web") : null
  ].filter((label): label is string => Boolean(label))
  const contextSummary =
    contextState.length > 0 ? contextState.join(" · ") : t("chat.context.none")

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
                  className="shrink-0 rounded-control text-muted-foreground hover:bg-muted/55 hover:text-foreground"
                  aria-label={t("tabs.context")}
                />
              }
            />
          }
          label={t("tabs.context")}
          icon={<Layers className="icon-sm" aria-hidden="true" />}
        />
        <PopoverContent
          align="end"
          sideOffset={8}
          className="max-h-[min(36rem,calc(100vh-8rem))] w-[min(20rem,calc(100vw-1.25rem))] max-w-[calc(100vw-1.25rem)] gap-3 overflow-y-auto rounded-panel p-2.5">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5 text-2xs font-bold uppercase tracking-wide text-muted-foreground">
              <Layers className="icon-xs" />
              {t("tabs.context")}
            </div>
          </div>
          <div className="rounded-control border border-border/40 bg-muted/25 px-2.5 py-2">
            <p className="text-micro font-medium uppercase text-muted-foreground">
              {t("chat.context.preview_title")}
            </p>
            <p className="mt-1 text-xs text-foreground">{contextSummary}</p>
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
            <Button
              type="button"
              variant="ghost"
              className="h-8 justify-start gap-2 rounded-control px-2 text-xs text-muted-foreground hover:bg-muted/55 hover:text-foreground"
              onClick={() => {
                setOpen(false)
                setPermsOpen(true)
              }}>
              <Lock className="icon-sm shrink-0" />
              <span className="min-w-0 flex-1 truncate text-left">
                {t("settings.permissions.title")}
              </span>
            </Button>
          </div>
          {tabAccess && (
            <TabContextPanel
              filteredTabOptions={filteredTabOptions}
              tabContents={tabContents}
              getTabStatus={getTabStatus}
              selectedTabIds={selectedTabIds}
              tabSearch={tabSearch}
              setTabSearch={setTabSearch}
              refreshTabs={refreshTabs}
              toggleTab={toggleTab}
              openPreview={openPreview}
            />
          )}
        </PopoverContent>
      </Popover>
      <PermissionsSheet open={permsOpen} onOpenChange={setPermsOpen} />
      <PreviewSheet
        open={Boolean(previewTabId)}
        onOpenChange={(next) => {
          if (!next) setPreviewTabId(null)
        }}
        title={previewTab?.title || t("tabs.inspector.untitled")}
        meta={t("tabs.inspector.chars", { count: previewCharCount })}
        actions={
          previewContent ? <CopyButton text={previewContent} /> : undefined
        }>
        <ScrollArea className="min-h-0 flex-1 overflow-x-hidden">
          <PreviewTextBlock
            text={previewContent || ""}
            emptyText={t("tabs.inspector.no_content")}
          />
        </ScrollArea>
      </PreviewSheet>
    </>
  )
}
