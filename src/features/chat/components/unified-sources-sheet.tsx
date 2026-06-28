import { type ReactNode, useMemo, useState } from "react"
import { useTranslation } from "react-i18next"

import { TooltipActionButton } from "@/components/actions"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { chatIconBtnCls } from "@/features/chat/lib/chat-styles"
import {
  BookOpen,
  Brain,
  ChevronDown,
  Database,
  ExternalLink,
  FileText,
  Globe,
  Info,
  type LucideIcon
} from "@/lib/lucide-icon"
import { cn } from "@/lib/utils"
import { ChunkFeedbackButton } from "./chunk-feedback-button"
import { CopyButton } from "./copy-button"
import type { SourceItem } from "./message-sources-sheet"
import { PreviewSheet } from "./preview-sheet"
import {
  hostOf,
  SearchEngineBadge,
  WebSourceFavicon
} from "./web-search-sources-button"

export type SourceGroup = "local" | "knowledge" | "web"

export interface UnifiedSection {
  group: SourceGroup
  label: string
  items: SourceItem[]
  /** Web results that were retrieved but not sent to the model. */
  unused?: boolean
}

export interface UnifiedSourcesSheetProps {
  badgeCount: number
  tooltip: string
  ariaLabel: string
  title: string
  subtitle?: string
  note?: ReactNode
  sections: UnifiedSection[]
  feedback?: { query: string; sessionId?: string }
}

const GROUP_META: Record<
  SourceGroup,
  { icon: LucideIcon; chip: string; tab: LucideIcon }
> = {
  local: {
    icon: FileText,
    chip: "bg-sky-500/12 text-sky-400",
    tab: FileText
  },
  knowledge: {
    icon: Brain,
    chip: "bg-violet-500/12 text-violet-400",
    tab: BookOpen
  },
  web: { icon: Globe, chip: "bg-muted text-muted-foreground", tab: Globe }
}

const COLLAPSED_COUNT = 4

const SourceRow = ({
  item,
  group,
  expanded,
  onToggle,
  feedback
}: {
  item: SourceItem
  group: SourceGroup
  expanded: boolean
  onToggle: () => void
  feedback?: { query: string; sessionId?: string }
}) => {
  const { t } = useTranslation()
  const isWeb = group === "web"
  const host = isWeb && item.url ? (hostOf(item.url) ?? item.url) : undefined
  const Icon = GROUP_META[group].icon

  return (
    <div className="group/row">
      <div className="flex items-start gap-2 px-2 py-2 sm:gap-2.5 sm:px-3 sm:py-2.5">
        <div
          className={cn(
            "mt-0.5 flex size-7 shrink-0 items-center justify-center overflow-hidden rounded-control",
            isWeb
              ? "border border-border/50 bg-background"
              : GROUP_META[group].chip
          )}>
          {isWeb && item.url ? (
            <WebSourceFavicon url={item.url} />
          ) : (
            <Icon className="icon-sm" aria-hidden="true" />
          )}
        </div>

        <div className="min-w-0 flex-1">
          {host && (
            <span className="flex min-w-0 items-center gap-1.5 text-micro text-muted-foreground">
              <a
                href={item.url}
                target="_blank"
                rel="noreferrer"
                title={item.url}
                className="truncate transition-colors hover:text-foreground hover:underline">
                {host}
              </a>
              <SearchEngineBadge engine={item.engine} />
            </span>
          )}
          <button
            type="button"
            onClick={onToggle}
            className="block w-full min-w-0 text-left">
            <span className="block truncate text-xs font-medium text-foreground">
              {item.title}
            </span>
            {item.content && (
              <span
                className={cn(
                  "block text-micro text-muted-foreground",
                  expanded
                    ? "whitespace-pre-wrap wrap-anywhere"
                    : "line-clamp-1"
                )}>
                {item.content}
              </span>
            )}
            {!isWeb && (item.sectionPath || item.source) && (
              <span className="block truncate text-nano text-muted-foreground/70">
                {[item.sectionPath, item.source !== "rag" ? item.source : null]
                  .filter(Boolean)
                  .join(" · ")}
              </span>
            )}
            {item.publishedAt && (
              <span className="block text-nano text-muted-foreground/70">
                {t("chat.sources.web_published", { date: item.publishedAt })}
              </span>
            )}
          </button>
        </div>

        <div className="flex shrink-0 items-center gap-1">
          {item.score > 0 && (
            <span className="rounded-control bg-emerald-500/12 px-1.5 py-0.5 text-micro font-medium text-emerald-400 tabular-nums">
              {item.score.toFixed(2)}
            </span>
          )}
          <button
            type="button"
            onClick={onToggle}
            aria-expanded={expanded}
            className="flex size-6 items-center justify-center rounded-control text-muted-foreground transition-colors hover:bg-muted/55 hover:text-foreground">
            <ChevronDown
              className={cn(
                "icon-xs transition-transform",
                expanded && "rotate-180"
              )}
            />
          </button>
        </div>
      </div>

      {expanded && feedback && group === "knowledge" && (
        <div className="flex items-center gap-1 pb-2.5 pl-10 sm:pl-13">
          <ChunkFeedbackButton
            chunkId={String(item.chunkId ?? item.id)}
            query={feedback.query}
            sessionId={feedback.sessionId}
          />
        </div>
      )}
    </div>
  )
}

const SourceSection = ({
  section,
  feedback
}: {
  section: UnifiedSection
  feedback?: { query: string; sessionId?: string }
}) => {
  const { t } = useTranslation()
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set())
  const [showAll, setShowAll] = useState(false)

  const toggle = (id: string) =>
    setExpandedIds((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })

  const visible = showAll
    ? section.items
    : section.items.slice(0, COLLAPSED_COUNT)
  const hidden = section.items.length - visible.length

  const urls = section.items
    .map((item) => item.url)
    .filter((url): url is string => Boolean(url))

  return (
    <section className="space-y-1.5">
      <div className="flex items-center justify-between gap-2 px-0.5">
        <h3 className="text-2xs font-semibold uppercase tracking-wider text-muted-foreground">
          {section.label}
        </h3>
        <div className="flex items-center gap-0.5">
          {section.group === "web" && urls.length > 0 && (
            <button
              type="button"
              onClick={() => {
                for (const url of urls)
                  window.open(url, "_blank", "noopener,noreferrer")
              }}
              title={t("chat.sources.open_all_tabs")}
              aria-label={t("chat.sources.open_all_tabs")}
              className="flex size-6 items-center justify-center rounded-control text-muted-foreground transition-colors hover:bg-muted/55 hover:text-foreground">
              <ExternalLink className="icon-xs" />
            </button>
          )}
          <CopyButton
            text={section.items.map((item) => item.content).join("\n\n")}
          />
        </div>
      </div>
      <div className="divide-y divide-border/30 overflow-hidden rounded-control border border-border/40">
        {visible.map((item) => (
          <SourceRow
            key={`${section.group}-${item.id}`}
            item={item}
            group={section.group}
            expanded={expandedIds.has(String(item.id))}
            onToggle={() => toggle(String(item.id))}
            feedback={feedback}
          />
        ))}
      </div>
      {hidden > 0 && (
        <button
          type="button"
          onClick={() => setShowAll(true)}
          className="flex w-full items-center justify-center gap-1 rounded-control py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted/40 hover:text-foreground">
          {t("chat.sources.show_more", { count: hidden })}
          <ChevronDown className="icon-xs" />
        </button>
      )}
    </section>
  )
}

export function UnifiedSourcesSheet({
  badgeCount,
  tooltip,
  ariaLabel,
  title,
  subtitle,
  note,
  sections,
  feedback
}: UnifiedSourcesSheetProps) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [activeGroup, setActiveGroup] = useState<SourceGroup | "all">("all")

  const tabs = useMemo(() => {
    const order: SourceGroup[] = ["web", "knowledge", "local"]
    const counts = new Map<SourceGroup, number>()
    for (const section of sections) {
      counts.set(
        section.group,
        (counts.get(section.group) ?? 0) + section.items.length
      )
    }
    const present = order.filter((g) => (counts.get(g) ?? 0) > 0)
    return [
      {
        key: "all" as const,
        label: t("chat.sources.filter_all"),
        icon: Database,
        count: badgeCount
      },
      ...present.map((g) => ({
        key: g,
        label: t(`chat.sources.filter_${g}`),
        icon: GROUP_META[g].tab,
        count: counts.get(g) ?? 0
      }))
    ]
  }, [sections, badgeCount, t])

  const visibleSections =
    activeGroup === "all"
      ? sections
      : sections.filter((s) => s.group === activeGroup)

  if (badgeCount === 0) return null

  return (
    <>
      <TooltipActionButton
        trigger={
          <Button
            variant="ghost"
            size="sm"
            className={cn(chatIconBtnCls, "w-auto gap-1 px-1.5")}
            onClick={() => setOpen(true)}
            aria-label={ariaLabel}
          />
        }
        ariaLabel={ariaLabel}
        tooltip={tooltip}
        tooltipSide="top"
        icon={
          <>
            <BookOpen className="icon-xs" aria-hidden="true" />
            <span className="text-2xs font-medium tabular-nums">
              {badgeCount}
            </span>
          </>
        }
      />
      <PreviewSheet
        open={open}
        onOpenChange={setOpen}
        title={
          <span className="flex items-center gap-2">
            <BookOpen className="icon-sm shrink-0 text-muted-foreground" />
            {title}
          </span>
        }
        meta={subtitle}
        className="w-[min(32rem,calc(100vw-1rem))]">
        {tabs.length > 2 && (
          <div className="flex shrink-0 items-center gap-0.5 overflow-x-auto border-b border-border/35 px-1.5 scrollbar-none sm:gap-1 sm:px-3">
            {tabs.map((tab) => {
              const Icon = tab.icon
              const isActive = activeGroup === tab.key
              return (
                <button
                  key={tab.key}
                  type="button"
                  onClick={() => setActiveGroup(tab.key)}
                  className={cn(
                    "flex items-center gap-1.5 whitespace-nowrap border-b-2 px-1.5 py-2.5 text-xs font-medium transition-colors sm:px-2",
                    isActive
                      ? "border-primary text-foreground"
                      : "border-transparent text-muted-foreground hover:text-foreground"
                  )}>
                  <Icon className="icon-xs" />
                  {tab.label}
                  <span
                    className={cn(
                      "rounded-full px-1.5 text-nano tabular-nums",
                      isActive
                        ? "bg-primary/15 text-primary"
                        : "bg-muted text-muted-foreground"
                    )}>
                    {tab.count}
                  </span>
                </button>
              )
            })}
          </div>
        )}
        <ScrollArea className="min-h-0 flex-1 overflow-x-hidden">
          <div className="space-y-3 px-1.5 py-2.5 sm:space-y-4 sm:px-3 sm:py-3">
            {note && (
              <p className="px-0.5 text-micro text-muted-foreground">{note}</p>
            )}
            {visibleSections.map((section) => (
              <SourceSection
                key={`${section.group}-${section.label}`}
                section={section}
                feedback={feedback}
              />
            ))}
          </div>
        </ScrollArea>
        <div className="flex shrink-0 items-center gap-2 border-t border-border/35 px-3 py-2.5 text-micro text-muted-foreground sm:px-4">
          <Info className="icon-xs shrink-0" />
          {t("chat.sources.disclaimer")}
        </div>
      </PreviewSheet>
    </>
  )
}
