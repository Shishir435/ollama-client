import { useStorage } from "@plasmohq/storage/hook"
import {
  AppWindow,
  BrainCircuit,
  Camera,
  CheckIcon,
  ChevronLeft,
  Eye,
  FileText,
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
import { ScrollArea } from "@/components/ui/scroll-area"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger
} from "@/components/ui/sheet"
import { FileUploadButton } from "@/features/file-upload/components/file-upload-button"
import { useSelectedModelCapabilities } from "@/features/model/hooks/use-selected-model-capabilities"
import { PermissionsSheet } from "@/features/permissions/components/permissions-sheet"
import { useOpenTabs } from "@/features/tabs/hooks/use-open-tab"
import { useTabContents } from "@/features/tabs/hooks/use-tab-contents"
import { useTabStatusMap } from "@/features/tabs/hooks/use-tab-status-map"
import { useSelectedTabs } from "@/features/tabs/stores/selected-tabs-store"
import {
  useWebSearchActive,
  useWebSearchConfig
} from "@/features/web-search/stores/web-search-config-store"
import {
  DEFAULT_CONTENT_EXTRACTION_CONFIG,
  DEFAULT_EXCLUDE_URLS,
  DEFAULT_TABS_ACCESS,
  STORAGE_KEYS
} from "@/lib/constants"
import type { FileProcessingState } from "@/lib/file-processors/types"
import { Layers } from "@/lib/lucide-icon"
import {
  DEFAULT_PER_SITE_PROFILE_SETTINGS,
  getMatchingPerSiteProfile,
  type PerSiteProfileSettings
} from "@/lib/per-site-profiles"
import { plasmoGlobalStorage } from "@/lib/plasmo-global-storage"
import { matchesUserPattern } from "@/lib/url-pattern"
import { cn } from "@/lib/utils"
import type { ContentExtractionConfig, ImageAttachment } from "@/types"
import { CopyButton } from "../copy-button"
import { PreviewTextBlock } from "../preview-sheet"
import { AttachmentList } from "./attachment-list"

const trimTitle = (title: string, max = 38) =>
  title ? (title.length > max ? `${title.slice(0, max)}...` : title) : ""

const trimPreview = (text: string, max = 140) => {
  const compact = text.replace(/\s+/g, " ").trim()
  return compact.length > max ? `${compact.slice(0, max)}...` : compact
}

const EMPTY_PROFILE_LIST: PerSiteProfileSettings["profiles"] = []
const EMPTY_PROCESSING_STATES: FileProcessingState[] = []
const EMPTY_IMAGES: ImageAttachment[] = []

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
        "grid min-w-0 gap-0.5 rounded-control px-1.5 py-1 text-left text-xs transition-colors",
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
      <button
        type="button"
        className={cn(
          "w-full truncate rounded-control px-2 py-1 text-left text-2xs transition-colors",
          content
            ? "bg-muted/30 text-muted-foreground hover:bg-muted/50 hover:text-foreground"
            : "text-muted-foreground/70 italic hover:text-muted-foreground"
        )}
        onClick={onPreview}>
        {content ? trimPreview(content, 90) : t("tabs.inspector.no_content")}
      </button>
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
    <div className="grid gap-1.5 border-t border-border/40 pt-1.5">
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
  attachmentCount = 0,
  onFilesSelected,
  disabled = false,
  acceptImages = false,
  processingStates = EMPTY_PROCESSING_STATES,
  onRemoveFile,
  images = EMPTY_IMAGES,
  onRemoveImage,
  onCaptureScreenshot,
  showScreenshot = false
}: {
  attachmentCount?: number
  onFilesSelected?: (files: FileList) => void
  disabled?: boolean
  acceptImages?: boolean
  processingStates?: FileProcessingState[]
  onRemoveFile?: (file: File) => void
  images?: ImageAttachment[]
  onRemoveImage?: (imageId: string) => void
  onCaptureScreenshot?: () => void
  showScreenshot?: boolean
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
  // In-sheet sub-views: a tab preview (previewTabId set) or the attachment
  // list ("attachments") replace the main panel instead of opening a second
  // sheet, so the user never loses their place in the Context sheet.
  const [view, setView] = useState<"main" | "attachments">("main")
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
  const { config: webSearchConfig } = useWebSearchConfig()
  const { active: webSearchActive, setActive: setWebSearchActive } =
    useWebSearchActive()
  const showAutoScreenshot = capabilities?.vision ?? false
  // Row appears only when web search is configured in settings; the row's
  // check controls the per-device active flag, never the settings switch.
  const showWebSearch =
    (Boolean(capabilities?.toolCalling) || isResolving) &&
    Boolean(webSearchConfig.enabled)

  const excludedPatterns =
    config?.excludedUrlPatterns || oldPatterns || DEFAULT_EXCLUDE_URLS

  const tabOptions = useMemo(() => {
    const isAccessible = (url: string | undefined) => {
      if (!url) return false
      const matchingProfile = getMatchingPerSiteProfile(url, {
        profiles: perSiteProfileList
      })
      if (matchingProfile?.tabContext === "never") return false
      return !excludedPatterns.some((p) => matchesUserPattern(url, p))
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

  // The attachments view empties out when the user removes the last item —
  // fall back to the main panel instead of stranding them on a blank list.
  useEffect(() => {
    if (view === "attachments" && attachmentCount === 0) setView("main")
  }, [view, attachmentCount])

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

  const openPreview = (value: string) => setPreviewTabId(value)

  const handleOpenChange = (next: boolean) => {
    setOpen(next)
    if (!next) {
      setView("main")
      setPreviewTabId(null)
    }
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
            checked: webSearchActive,
            onClick: () => setWebSearchActive(!webSearchActive),
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
    showWebSearch && webSearchActive ? t("chat.context.web") : null
  ].filter((label): label is string => Boolean(label))
  const contextSummary =
    contextState.length > 0 ? contextState.join(" · ") : t("chat.context.none")

  return (
    <>
      <Sheet open={open} onOpenChange={handleOpenChange}>
        <TooltipActionButton
          trigger={
            <SheetTrigger
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
        <SheetContent
          side="right"
          className="w-[min(28rem,calc(100vw-1rem))] gap-2 overflow-y-auto p-2 sm:max-w-md"
          closeButtonClassName="top-2 right-2">
          <SheetHeader className="p-0 pr-10">
            <SheetTitle className="flex items-center gap-2">
              <Layers className="icon-sm" />
              {t("tabs.context")}
            </SheetTitle>
            <SheetDescription className="sr-only">
              {t("tabs.inspector.description")}
            </SheetDescription>
          </SheetHeader>
          {previewTabId ? (
            <div className="flex min-h-0 flex-1 flex-col gap-1.5">
              <div className="flex items-center gap-1.5">
                <TooltipActionButton
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  className="shrink-0 rounded-control text-muted-foreground hover:text-foreground"
                  onClick={() => setPreviewTabId(null)}
                  label={t("common.actions.back")}
                  icon={<ChevronLeft className="icon-sm" />}
                />
                <span className="min-w-0 flex-1 truncate text-xs font-medium">
                  {previewTab?.title || t("tabs.inspector.untitled")}
                </span>
                <span className="shrink-0 text-2xs text-muted-foreground">
                  {t("tabs.inspector.chars", { count: previewCharCount })}
                </span>
                {previewContent && <CopyButton text={previewContent} />}
              </div>
              <ScrollArea className="min-h-0 flex-1 rounded-control border border-border/35 bg-background/35">
                <PreviewTextBlock
                  text={previewContent || ""}
                  emptyText={t("tabs.inspector.no_content")}
                />
              </ScrollArea>
            </div>
          ) : view === "attachments" ? (
            <div className="flex min-h-0 flex-1 flex-col gap-1.5">
              <div className="flex items-center gap-1.5">
                <TooltipActionButton
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  className="shrink-0 rounded-control text-muted-foreground hover:text-foreground"
                  onClick={() => setView("main")}
                  label={t("common.actions.back")}
                  icon={<ChevronLeft className="icon-sm" />}
                />
                <span className="min-w-0 flex-1 truncate text-xs font-medium">
                  {t("chat.input.attachments", { count: attachmentCount })}
                </span>
              </div>
              <ScrollArea className="min-h-0 flex-1 overflow-x-hidden">
                <AttachmentList
                  processingStates={processingStates}
                  onRemove={onRemoveFile ?? (() => undefined)}
                  images={images}
                  onRemoveImage={onRemoveImage}
                />
              </ScrollArea>
            </div>
          ) : (
            <>
              <div className="rounded-control border border-border/40 bg-muted/25 px-2.5 py-1.5">
                <p className="text-micro font-medium uppercase text-muted-foreground">
                  {t("chat.context.preview_title")}
                </p>
                <p className="mt-0.5 text-xs text-foreground">
                  {contextSummary}
                </p>
              </div>
              {(onFilesSelected ||
                attachmentCount > 0 ||
                (showScreenshot && onCaptureScreenshot)) && (
                <div className="grid grid-cols-2 gap-1.5">
                  {onFilesSelected && (
                    <div className="col-span-2 flex items-center justify-between gap-2 rounded-control border border-border/40 px-2.5 py-1.5">
                      <div className="min-w-0">
                        <p className="truncate text-xs font-medium text-foreground">
                          {t(
                            acceptImages
                              ? "file_upload.button.aria_label_with_images"
                              : "file_upload.button.aria_label"
                          )}
                        </p>
                        <p className="truncate text-2xs text-muted-foreground">
                          {t(
                            acceptImages
                              ? "file_upload.button.formats_with_images"
                              : "file_upload.button.formats"
                          )}
                        </p>
                      </div>
                      <FileUploadButton
                        onFilesSelected={onFilesSelected}
                        disabled={disabled}
                        acceptImages={acceptImages}
                      />
                    </div>
                  )}
                  {attachmentCount > 0 && (
                    <Button
                      type="button"
                      variant="outline"
                      className="h-auto justify-start gap-2 px-2.5 py-2 text-xs"
                      onClick={() => setView("attachments")}>
                      <FileText className="icon-sm" />
                      {t("chat.input.attachments", { count: attachmentCount })}
                    </Button>
                  )}
                  {showScreenshot && onCaptureScreenshot && (
                    <Button
                      type="button"
                      variant="outline"
                      className="h-auto justify-start gap-2 px-2.5 py-2 text-xs"
                      disabled={disabled}
                      onClick={onCaptureScreenshot}>
                      <Camera className="icon-sm" />
                      {t("chat.input.screenshot")}
                    </Button>
                  )}
                </div>
              )}
              <div className="grid gap-0.5">
                {toggleActions.map((action) => {
                  const Icon = action.icon
                  return (
                    <Button
                      key={action.key}
                      type="button"
                      variant="ghost"
                      className={cn(
                        "h-7 justify-start gap-2 rounded-control px-2 text-xs",
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
                  className="h-7 justify-start gap-2 rounded-control px-2 text-xs text-muted-foreground hover:bg-muted/55 hover:text-foreground"
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
            </>
          )}
        </SheetContent>
      </Sheet>
      <PermissionsSheet open={permsOpen} onOpenChange={setPermsOpen} />
    </>
  )
}
