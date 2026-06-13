import {
  ChevronDown,
  Circle,
  FileStack,
  ListTree,
  PanelsTopLeft,
  Search,
  Sparkles,
  TextSelect
} from "lucide-react"
import { useState } from "react"
import { useTranslation } from "react-i18next"
import { TooltipActionButton } from "@/components/actions"
import { MarkdownRenderer } from "@/components/markdown-renderer"
import {
  Popover,
  PopoverContent,
  PopoverTrigger
} from "@/components/ui/popover"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger
} from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"
import type { ChatMessage, ToolRun } from "@/types"

type TraceStatus = "running" | "done" | "error"

interface TraceStep {
  key: string
  label: string
  status: TraceStatus
  icon?: React.ComponentType<{ className?: string }>
  detail?: string
}

const statusClass = (status: TraceStatus) =>
  ({
    running: "text-app-primary",
    done: "text-muted-foreground/80",
    error: "text-status-danger"
  })[status]

const getDisplayLabel = (label: string, status: TraceStatus) =>
  status === "running" ? `${label}...` : label

const getToolRunStatus = (run: ToolRun): TraceStatus =>
  run.status === "running"
    ? "running"
    : run.status === "error"
      ? "error"
      : "done"

const TOOL_LABEL_KEYS: Record<string, string> = {
  "web-search": "chat.reasoning.trace.web",
  rag_search: "chat.reasoning.trace.knowledge",
  file_search: "chat.reasoning.trace.documents",
  current_tab: "chat.reasoning.trace.tab",
  list_tabs: "chat.reasoning.trace.tabs",
  read_tab: "chat.reasoning.trace.tab",
  selected_text: "chat.reasoning.trace.selection"
}

const TOOL_ICONS: Record<
  string,
  React.ComponentType<{ className?: string }>
> = {
  "web-search": Search,
  rag_search: Search,
  file_search: FileStack,
  current_tab: PanelsTopLeft,
  list_tabs: PanelsTopLeft,
  read_tab: PanelsTopLeft,
  selected_text: TextSelect
}

const getToolRunLabel = (run: ToolRun, t: (key: string) => string): string => {
  const key = TOOL_LABEL_KEYS[run.toolId]
  return key ? t(key) : run.label
}

const getToolRunDetail = (run: ToolRun) => {
  if (run.error) return run.error
  if (run.sources?.length) {
    return run.sources.map((source) => source.title).join(", ")
  }
  return undefined
}

const buildToolTraceStep = (
  run: ToolRun,
  t: (key: string) => string
): TraceStep => ({
  key: `tool-${run.toolId}-${run.startedAt}`,
  label: getToolRunLabel(run, t),
  status: getToolRunStatus(run),
  icon: TOOL_ICONS[run.toolId] ?? Circle,
  detail: getToolRunDetail(run)
})

export interface ReasoningTraceProps {
  message: ChatMessage
  isLoading?: boolean
  isStreaming?: boolean
}

export const shouldShowReasoningTrace = (
  message: ChatMessage,
  isLoading = false,
  isStreaming = false
) => {
  const hasThinking = Boolean(message.thinking?.trim())
  const toolRuns = message.metrics?.toolRuns ?? []
  const usedContextChunks = message.metrics?.usedContextChunks ?? []
  const ragSources = message.metrics?.ragSources ?? []
  const hasFileContext =
    Boolean(message.metrics?.ragContextLength) ||
    ragSources.some((source) => source.type !== "webpage") ||
    Boolean(message.attachments?.length)
  const hasPageContext =
    Boolean(message.metrics?.tabContextLength) ||
    usedContextChunks.some((chunk) => chunk.source === "tab")
  const isBusy = isLoading || isStreaming

  return (
    hasThinking ||
    isBusy ||
    toolRuns.length > 0 ||
    hasFileContext ||
    hasPageContext
  )
}

export const ReasoningTrace = ({
  message,
  isLoading = false,
  isStreaming = false
}: ReasoningTraceProps) => {
  const { t } = useTranslation()
  const [showDetails, setShowDetails] = useState(false)
  const hasThinking = Boolean(message.thinking?.trim())
  const toolRuns = message.metrics?.toolRuns ?? []
  const usedContextChunks = message.metrics?.usedContextChunks ?? []
  const ragSources = message.metrics?.ragSources ?? []
  const hasFileContext =
    Boolean(message.metrics?.ragContextLength) ||
    ragSources.some((source) => source.type !== "webpage") ||
    Boolean(message.attachments?.length)
  const hasPageContext =
    Boolean(message.metrics?.tabContextLength) ||
    usedContextChunks.some((chunk) => chunk.source === "tab")
  const isBusy = isLoading || isStreaming

  if (!shouldShowReasoningTrace(message, isLoading, isStreaming)) {
    return null
  }

  const hasVisibleContent = Boolean(message.content?.trim())
  const steps: TraceStep[] = [
    isBusy && !hasVisibleContent
      ? {
          key: "thinking",
          label: t("chat.reasoning.trace.thinking"),
          status: "running",
          icon: Sparkles
        }
      : null,
    hasPageContext
      ? {
          key: "page",
          label: t("chat.reasoning.trace.page"),
          status: "done",
          icon: PanelsTopLeft
        }
      : null,
    hasFileContext
      ? {
          key: "files",
          label: t("chat.reasoning.trace.files"),
          status: "done",
          icon: FileStack
        }
      : null,
    ...toolRuns.map((run) => buildToolTraceStep(run, t)),
    isBusy && hasVisibleContent
      ? {
          key: "answering",
          label: t("chat.reasoning.trace.answering"),
          status: "running",
          icon: Circle
        }
      : null
  ].filter(Boolean) as TraceStep[]
  const activeStep =
    steps.find((step) => step.status === "running") ??
    steps.find((step) => step.status === "error")
  const activeLabel = activeStep
    ? activeStep.status === "error" && activeStep.detail
      ? `${activeStep.label}: ${activeStep.detail}`
      : getDisplayLabel(activeStep.label, activeStep.status)
    : undefined

  return (
    <section className="mb-2 inline-flex max-w-full items-center gap-1 rounded-chip bg-background/35 px-1 py-0.5 text-xs">
      <div className="flex min-w-0 items-center gap-0.5">
        <span className="sr-only">{t("chat.reasoning.aria_label")}</span>
        {steps.map((step) => {
          const Icon = step.icon ?? Circle
          const label = getDisplayLabel(step.label, step.status)
          const tooltip = step.detail ? `${label}: ${step.detail}` : label
          return (
            <TooltipActionButton
              key={step.key}
              trigger={
                <span
                  className={cn(
                    "inline-flex size-7 items-center justify-center rounded-control transition-colors hover:bg-muted/45",
                    statusClass(step.status)
                  )}
                />
              }
              tooltip={tooltip}
              icon={
                <>
                  <Icon
                    className={cn(
                      "icon-sm",
                      step.status === "running" && "animate-pulse"
                    )}
                  />
                  <span className="sr-only">{label}</span>
                </>
              }
            />
          )
        })}
      </div>

      {activeLabel && (
        <span
          className={cn(
            "max-w-28 truncate pr-1 text-[11px]",
            activeStep?.status === "error"
              ? "text-status-danger"
              : "text-muted-foreground"
          )}>
          {activeLabel}
        </span>
      )}

      {hasThinking && (
        <Popover open={showDetails} onOpenChange={setShowDetails}>
          <Tooltip>
            <TooltipTrigger
              render={
                <PopoverTrigger
                  render={
                    <button
                      type="button"
                      className="inline-flex h-7 items-center gap-0.5 rounded-control px-1 text-muted-foreground transition-colors hover:bg-muted/45 hover:text-foreground"
                      aria-expanded={showDetails}
                      aria-label={t("chat.reasoning.title")}
                    />
                  }
                />
              }>
              <ListTree className="icon-sm" />
              <ChevronDown
                className={cn(
                  "icon-xs transition-transform",
                  showDetails && "rotate-180"
                )}
              />
            </TooltipTrigger>
            <TooltipContent>{t("chat.reasoning.title")}</TooltipContent>
          </Tooltip>
          <PopoverContent
            align="start"
            sideOffset={6}
            className="max-h-64 w-[min(32rem,calc(100vw-4rem))] overflow-y-auto rounded-panel border border-border/35 bg-popover px-3 py-2 text-[12.5px] leading-relaxed text-popover-foreground shadow-md">
            <MarkdownRenderer content={message.thinking ?? ""} />
          </PopoverContent>
        </Popover>
      )}
    </section>
  )
}
