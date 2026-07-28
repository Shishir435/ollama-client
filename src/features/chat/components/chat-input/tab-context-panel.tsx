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
