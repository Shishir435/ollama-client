import {
  AppWindow,
  CheckIcon,
  Eye,
  Loader2,
  RefreshCw,
  Search
} from "lucide-react"
import { useTranslation } from "react-i18next"

import { TooltipActionButton } from "@/components/actions"
import { EmptyState } from "@/components/feedback"
import { ListRow, ListRowTitleButton } from "@/components/layout"
import { Input } from "@/components/ui/input"
import { ScrollArea } from "@/components/ui/scroll-area"
import { cn } from "@/lib/utils"

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
      // The row sits inside the scroll list's own padding, so it pays only the
      // remainder of the shared content inset.
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
            size="icon"
            className="size-5 rounded-control text-muted-foreground hover:text-foreground"
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
              ? "bg-muted/30 text-muted-foreground hover:bg-muted/50 hover:text-foreground"
              : "text-muted-foreground/70 italic hover:text-muted-foreground"
          )}
          onClick={onPreview}>
          {content ? trimPreview(content, 90) : t("tabs.inspector.no_content")}
        </button>
      }>
      <ListRowTitleButton onClick={onToggle} title={option.label}>
        {option.label}
      </ListRowTitleButton>
    </ListRow>
  )
}

interface TabContextPanelProps {
  filteredTabOptions: { value: string; label: string }[]
  tabContents: Record<number, { html?: string; title?: string } | undefined>
  getTabStatus: (id: string) => { loading: boolean }
  selectedTabIds: string[]
  tabSearch: string
  setTabSearch: (value: string) => void
  refreshTabs: () => void
  toggleTab: (id: string) => void
  openPreview: (id: string) => void
}

export const TabContextPanel = ({
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
    <div className="flex min-h-0 flex-1 flex-col gap-1.5 border-t border-border/40 pt-1.5">
      <div className="flex shrink-0 items-center justify-between gap-2 pl-2.5 pr-1 text-2xs font-medium text-muted-foreground">
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
        className="min-h-32 flex-1 rounded-control border border-border/35 bg-background/35">
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
              icon={AppWindow}
              title={t("tabs.inspector.no_content")}
            />
          )}
        </div>
      </ScrollArea>
    </div>
  )
}
