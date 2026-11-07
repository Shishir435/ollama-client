import {
  AppWindow,
  Check as CheckIcon,
  Eye,
  Loader2,
  RefreshCw,
  Search,
  SquareCheck,
  SquareMinus
} from "lucide-react"
import { useState } from "react"
import { useTranslation } from "react-i18next"
import { TooltipActionButton } from "@/components/actions"
import { EmptyState } from "@/components/feedback"
import { ListRow, ListRowTitleButton } from "@/components/layout"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { ScrollArea } from "@/components/ui/scroll-area"
import type { TabListEmptyReason } from "@/features/chat/hooks/use-context-tab-options"
import { cn } from "@/lib/class-names"

const trimPreview = (text: string, max = 140) => {
  const compact = text.replace(/\s+/g, " ").trim()
  return compact.length > max ? `${compact.slice(0, max)}...` : compact
}

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
    <ListRow
      density="compact"
      /**
       * The row sits inside the scroll list's own padding, so it pays only the
       * remainder of the shared content inset.
       */
      inset="nested"
      trailingKind="control"
      active={isSelected}
      leading={<AppWindow className="icon-sm" />}
      trailing={
        <>
          {isLoading && <Loader2 className="icon-xs shrink-0 animate-spin" />}
          {isSelected && !isLoading && (
            <CheckIcon className="icon-xs shrink-0 text-app-primary" />
          )}
          <TooltipActionButton
            type="button"
            variant="ghost"
            size="icon-xs"
            className="rounded-control text-muted-foreground hover:text-foreground"
            onClick={onPreview}
            label={t("tabs.select.view_content")}
            icon={<Eye className="icon-xs" />}
          />
        </>
      }
      below={
        <button
          type="button"
          className={cn(
            "w-full truncate rounded-control px-1.5 py-0.5 text-left text-2xs transition-colors",
            content
              ? "bg-surface-sunken text-muted-foreground hover:bg-state-hover hover:text-foreground"
              : "text-foreground-tertiary italic hover:text-muted-foreground"
          )}
          aria-label={t("tabs.select.view_content_named", {
            title: option.label
          })}
          onClick={onPreview}>
          {content ? trimPreview(content, 90) : t("tabs.inspector.no_content")}
        </button>
      }>
      <ListRowTitleButton
        onClick={onToggle}
        title={option.label}
        aria-pressed={isSelected}
        aria-label={option.label}>
        {option.label}
      </ListRowTitleButton>
    </ListRow>
  )
}

interface TabContextPanelProps {
  filteredTabOptions: { value: string; label: string }[]
  emptyReason?: TabListEmptyReason | null
  allVisibleSelected: boolean
  toggleAllVisible: () => void
  tabContents: Record<number, { html?: string; title?: string } | undefined>
  getTabStatus: (id: string) => { loading: boolean }
  selectedTabIds: string[]
  tabSearch: string
  setTabSearch: (value: string) => void
  refreshTabs: () => void
  toggleTab: (id: string) => void
  openPreview: (id: string) => void
  /** The active provider is a public host: page text leaves the user's network. */
  remoteProvider?: boolean
}

export const TabContextPanel = ({
  filteredTabOptions,
  emptyReason = null,
  allVisibleSelected,
  toggleAllVisible,
  tabContents,
  getTabStatus,
  selectedTabIds,
  tabSearch,
  setTabSearch,
  refreshTabs,
  toggleTab,
  openPreview,
  remoteProvider = false
}: TabContextPanelProps) => {
  const { t } = useTranslation()
  const [confirmingAll, setConfirmingAll] = useState(false)
  const visibleIds = new Set(filteredTabOptions.map((option) => option.value))
  const selectedCount = selectedTabIds.filter((id) => visibleIds.has(id)).length
  const addedCount = filteredTabOptions.filter(
    (option) => !selectedTabIds.includes(option.value)
  ).length
  const needsConfirm = !allVisibleSelected && remoteProvider && addedCount > 1
  const handleToggleAll = () => {
    if (needsConfirm) {
      setConfirmingAll(true)
      return
    }
    setConfirmingAll(false)
    toggleAllVisible()
  }
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-1.5 border-t border-border pt-1.5">
      <div className="flex shrink-0 items-center justify-between gap-2 pl-2.5 pr-1 text-2xs font-medium text-muted-foreground">
        {/* How many tabs are actually going into the prompt, rather than a static
            "Select open tabs" instruction — the count is the thing that changes
            and the thing worth checking before sending. */}
        <output className="min-w-0 truncate" aria-live="polite">
          {filteredTabOptions.length > 0
            ? t("tabs.select.ready", {
                selected: selectedCount,
                total: filteredTabOptions.length
              })
            : t("tabs.select.placeholder")}
        </output>
        <div className="flex shrink-0 items-center">
          {filteredTabOptions.length > 1 && (
            <TooltipActionButton
              type="button"
              variant="ghost"
              size="icon"
              className="size-6 rounded-control"
              onClick={handleToggleAll}
              label={
                allVisibleSelected
                  ? t("tabs.select.clear_selection")
                  : t("tabs.select.select_all")
              }
              icon={
                allVisibleSelected ? (
                  <SquareMinus className="icon-xs" />
                ) : (
                  <SquareCheck className="icon-xs" />
                )
              }
            />
          )}
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
      </div>
      {confirmingAll && needsConfirm && (
        <div
          role="alert"
          className="flex shrink-0 flex-col gap-1.5 rounded-control border border-status-warning bg-surface-sunken p-2 text-2xs text-foreground">
          <p className="min-w-0 break-words">
            {t("tabs.select.remote_confirm", { count: addedCount })}
          </p>
          <div className="flex flex-wrap justify-end gap-1.5">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setConfirmingAll(false)}>
              {t("tabs.select.remote_confirm_cancel")}
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={() => {
                setConfirmingAll(false)
                toggleAllVisible()
              }}>
              {t("tabs.select.remote_confirm_apply", { count: addedCount })}
            </Button>
          </div>
        </div>
      )}
      <div className="relative shrink-0">
        <Search className="-translate-y-1/2 pointer-events-none absolute top-1/2 left-2.5 icon-sm text-muted-foreground" />
        <Input
          value={tabSearch}
          onChange={(event) => setTabSearch(event.target.value)}
          placeholder={t("tabs.select.search_placeholder")}
          className="h-7 rounded-control pl-8 text-xs"
          aria-label={t("tabs.select.search_placeholder")}
        />
      </div>
      {/* Fills whatever height the sheet has left instead of a fixed cap, so a
          tall side panel shows the whole tab list rather than clipping a row
          mid-height and leaving the rest of the sheet empty. The min-height
          keeps the list usable when the controls above it are all visible. */}
      <ScrollArea
        hideScrollbar
        className="min-h-32 flex-1 rounded-control border border-border bg-surface-sunken">
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
            <EmptyState
              density="compact"
              icon={emptyReason === "search" ? Search : AppWindow}
              title={
                emptyReason === "search"
                  ? t("tabs.select.no_matches", { query: tabSearch.trim() })
                  : emptyReason === "excluded"
                    ? t("tabs.select.all_excluded")
                    : t("tabs.select.no_tabs")
              }
            />
          )}
        </div>
      </ScrollArea>
    </div>
  )
}
