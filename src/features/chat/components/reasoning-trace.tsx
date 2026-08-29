import {
  Camera,
  ChevronDown,
  Circle,
  Download,
  FileSearch,
  FileStack,
  FileText,
  Globe,
  List,
  ListTree,
  PanelsTopLeft,
  Search,
  Sparkles,
  TextSelect
} from "lucide-react"
import { useEffect, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { TooltipActionButton } from "@/components/actions"
import { cn } from "@/lib/class-names"
import { getToolDisplayMeta } from "@/lib/tools/tool-display"
import type { ActivityEvent, ChatMessage, ToolRun } from "@/types"
import {
  ActivityStepRow,
  getActivityEventLabel,
  getActivityEventStatus,
  getActivityResultCountLabel,
  getActivityText,
  getToolRunLabel,
  getToolRunStatus,
  statusClass,
  ThinkingEvent,
  ToolStepRow,
  type TraceStatus
} from "./reasoning-trace-events"

interface TraceStep {
  key: string
  label: string
  status: TraceStatus
  icon?: React.ComponentType<{ className?: string }>
  detail?: string
  preview?: string
}

const TOOL_ICONS: Record<
  string,
  React.ComponentType<{ className?: string }>
> = {
  search: Search,
  globe: Globe,
  "file-stack": FileStack,
  "panels-top-left": PanelsTopLeft,
  list: List,
  "file-text": FileText,
  "text-select": TextSelect,
  download: Download,
  camera: Camera
}

const ACTIVITY_ICONS: Record<
  ActivityEvent["kind"],
  React.ComponentType<{ className?: string }>
> = {
  preparing_context: Sparkles,
  query_rewrite: ListTree,
  searching_memory: Search,
  searching_files: FileSearch,
  reading_page: PanelsTopLeft,
  calling_tool: Circle,
  generating_answer: Circle
}

const buildToolTraceStep = (
  run: ToolRun,
  t: (key: string) => string
): TraceStep => {
  const meta = getToolDisplayMeta(run.toolId)
  const iconKey = run.iconKey ?? meta.iconKey
  return {
    key: `tool-${run.toolId}-${run.startedAt}`,
    label: getToolRunLabel(run, t),
    status: getToolRunStatus(run),
    icon: iconKey ? (TOOL_ICONS[iconKey] ?? Circle) : Circle,
    detail: run.error
  }
}

const isWebToolRun = (run: ToolRun) =>
  run.category === "web" || run.toolId === "web_search"

const getGroupedToolRunStatus = (runs: ToolRun[]): TraceStatus => {
  if (runs.some((run) => run.status === "running")) return "running"
  if (runs.some((run) => run.status === "error")) return "error"
  return "done"
}

const buildWebToolTraceStep = (
  runs: ToolRun[],
  t: (key: string, options?: { count?: number }) => string
): TraceStep => {
  const firstRun = runs[0]
  const firstError = runs.find((run) => run.error)?.error
  return {
    key: "tool-web-search-group",
    label: firstRun
      ? getToolRunLabel(firstRun, t)
      : t("chat.reasoning.trace.web"),
    status: getGroupedToolRunStatus(runs),
    icon: Globe,
    detail: firstError,
    preview:
      runs.length > 1
        ? t("chat.reasoning.trace.searches", { count: runs.length })
        : undefined
  }
}

const buildCompactToolTraceSteps = (
  toolRuns: ToolRun[],
  t: (key: string, options?: { count?: number }) => string
): TraceStep[] => {
  const webRuns: ToolRun[] = []
  const steps: (TraceStep | "web-search-group")[] = []

  for (const run of toolRuns) {
    if (isWebToolRun(run)) {
      webRuns.push(run)
      if (!steps.includes("web-search-group")) steps.push("web-search-group")
      continue
    }
    steps.push(buildToolTraceStep(run, t))
  }

  return steps.map((step) =>
    step === "web-search-group" ? buildWebToolTraceStep(webRuns, t) : step
  )
}

const getActivityCompactPreview = (
  event: ActivityEvent,
  t: (key: string, options?: { count?: number }) => string
): string | undefined => {
  if (event.error) return event.error
  if (event.outputPreview) return getActivityText(event.outputPreview, t)
  if (event.resultCount !== undefined) {
    const sources = event.sourceTitles?.length
      ? `: ${event.sourceTitles.map((title) => getActivityText(title, t)).join(", ")}`
      : ""
    return `${getActivityResultCountLabel(event.resultCount, t)}${sources}`
  }
  return event.inputPreview
}

const buildActivityTraceStep = (
  event: ActivityEvent,
  t: (key: string, options?: { count?: number }) => string
): TraceStep => ({
  key: `activity-${event.id}`,
  label: getActivityEventLabel(event, t),
  status: getActivityEventStatus(event),
  icon: ACTIVITY_ICONS[event.kind] ?? Circle,
  detail: event.error,
  preview: getActivityCompactPreview(event, t)
})

export interface ReasoningTraceProps {
  message: ChatMessage
  isLoading?: boolean
  isStreaming?: boolean
}

type TraceContext = {
  hasThinking: boolean
  activityEvents: ActivityEvent[]
  toolRuns: ToolRun[]
  hasFileContext: boolean
  hasPageContext: boolean
  isBusy: boolean
  hasVisibleContent: boolean
  isThinkingOnlyFallback: boolean
  hasActivityDetails: boolean
  hasDetails: boolean
}

const getTraceContext = (
  message: ChatMessage,
  isLoading: boolean,
  isStreaming: boolean
): TraceContext => {
  const activityEvents = message.metrics?.activityEvents ?? []
  const toolRuns = message.metrics?.toolRuns ?? []
  const usedContextChunks = message.metrics?.usedContextChunks ?? []
  const ragSources = message.metrics?.ragSources ?? []
  const hasThinking = Boolean(message.thinking?.trim())
  const hasFileContext =
    Boolean(message.metrics?.ragContextLength) ||
    ragSources.some((source) => source.type !== "webpage") ||
    Boolean(message.attachments?.length)
  const hasPageContext =
    Boolean(message.metrics?.tabContextLength) ||
    usedContextChunks.some((chunk) => chunk.source === "tab")
  const hasActivityDetails = activityEvents.length > 0 || toolRuns.length > 0
  return {
    hasThinking,
    activityEvents,
    toolRuns,
    hasFileContext,
    hasPageContext,
    isBusy: isLoading || isStreaming,
    hasVisibleContent: Boolean(message.content?.trim()),
    isThinkingOnlyFallback: message.metrics?.thinkingOnlyResponse === true,
    hasActivityDetails,
    hasDetails: hasActivityDetails || hasThinking
  }
}

export const shouldShowReasoningTrace = (
  message: ChatMessage,
  isLoading = false,
  isStreaming = false
) => {
  const context = getTraceContext(message, isLoading, isStreaming)
  return (
    context.hasThinking ||
    context.isBusy ||
    context.activityEvents.length > 0 ||
    context.toolRuns.length > 0 ||
    context.hasFileContext ||
    context.hasPageContext
  )
}

const buildTraceSteps = (
  context: TraceContext,
  t: (key: string, options?: { count?: number }) => string
): TraceStep[] => {
  const steps: Array<TraceStep | null> = [
    ...context.activityEvents.map((event) => buildActivityTraceStep(event, t)),
    context.isBusy &&
    !context.hasVisibleContent &&
    context.activityEvents.length === 0
      ? {
          key: "thinking",
          label: t("chat.reasoning.trace.preparing"),
          status: "running",
          icon: Sparkles
        }
      : null,
    context.hasPageContext
      ? {
          key: "page",
          label: t("chat.reasoning.trace.page"),
          status: "done",
          icon: PanelsTopLeft
        }
      : null,
    context.hasFileContext
      ? {
          key: "files",
          label: t("chat.reasoning.trace.files"),
          status: "done",
          icon: FileStack
        }
      : null,
    ...buildCompactToolTraceSteps(context.toolRuns, t),
    context.isBusy && context.hasVisibleContent
      ? {
          key: "answering",
          label: t("chat.reasoning.trace.answering"),
          status: "running",
          icon: Circle
        }
      : null
  ]
  return steps.filter((step): step is TraceStep => step !== null)
}

const getActiveStep = (
  steps: TraceStep[],
  hasVisibleContent: boolean
): TraceStep | undefined =>
  steps.find((step) => step.status === "running") ??
  (!hasVisibleContent
    ? steps.find((step) => step.status === "error")
    : undefined)

const getActiveLabel = (step?: TraceStep): string | undefined => {
  if (!step) return undefined
  if (step.status === "error" && step.detail) {
    return `${step.label}: ${step.detail}`
  }
  return step.preview ? `${step.label}: ${step.preview}` : step.label
}

export const ReasoningTrace = ({
  message,
  isLoading = false,
  isStreaming = false
}: ReasoningTraceProps) => {
  const { t } = useTranslation()
  const [detailsOpen, setDetailsOpen] = useState(false)
  const userControlledRef = useRef(false)
  const autoOpenedRef = useRef(false)
  const autoCollapsedRef = useRef(false)
  const reasoningBodyRef = useRef<HTMLDivElement>(null)
  const context = getTraceContext(message, isLoading, isStreaming)

  useEffect(() => {
    if (userControlledRef.current) return
    if (
      context.isThinkingOnlyFallback &&
      context.hasDetails &&
      !autoOpenedRef.current
    ) {
      autoOpenedRef.current = true
      setDetailsOpen(true)
      return
    }
    if (
      context.isBusy &&
      context.hasActivityDetails &&
      !context.hasVisibleContent &&
      !autoOpenedRef.current
    ) {
      autoOpenedRef.current = true
      setDetailsOpen(true)
      return
    }
    if (
      context.hasVisibleContent &&
      !context.isThinkingOnlyFallback &&
      !autoCollapsedRef.current
    ) {
      autoCollapsedRef.current = true
      setDetailsOpen(false)
    }
  }, [
    context.isBusy,
    context.hasDetails,
    context.hasVisibleContent,
    context.isThinkingOnlyFallback,
    context.hasActivityDetails
  ])

  const toggleDetails = () => {
    userControlledRef.current = true
    setDetailsOpen((open) => !open)
  }

  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll on thinking growth
  useEffect(() => {
    if (detailsOpen && context.isBusy && reasoningBodyRef.current) {
      reasoningBodyRef.current.scrollTop = reasoningBodyRef.current.scrollHeight
    }
  }, [
    message.thinking,
    context.activityEvents.length,
    context.toolRuns.length,
    detailsOpen,
    context.isBusy
  ])

  if (!shouldShowReasoningTrace(message, isLoading, isStreaming)) return null

  const steps = buildTraceSteps(context, t)
  const activeStep = getActiveStep(steps, context.hasVisibleContent)
  const activeLabel = getActiveLabel(activeStep)
  const reasoningLabel = t("chat.reasoning.title")

  return (
    <section className="mb-2 flex max-w-full flex-col gap-1 text-xs">
      <div className="inline-flex min-w-0 max-w-full items-center gap-1 overflow-hidden rounded-chip bg-background/35 px-1 py-0.5">
        <div className="flex shrink-0 items-center gap-0.5">
          <span className="sr-only">{t("chat.reasoning.aria_label")}</span>
          {steps.map((step) => {
            const Icon = step.icon ?? Circle
            const label = step.label
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
              "min-w-0 flex-1 truncate pr-1 text-2xs",
              activeStep?.status === "error"
                ? "text-status-danger"
                : "text-muted-foreground",
              activeStep?.status === "running" && "shimmer"
            )}>
            {activeLabel}
          </span>
        )}

        {context.hasDetails && (
          <button
            type="button"
            onClick={toggleDetails}
            aria-expanded={detailsOpen}
            className="inline-flex h-7 shrink-0 items-center gap-0.5 whitespace-nowrap rounded-control px-1.5 text-2xs text-muted-foreground transition-colors hover:bg-muted/45 hover:text-foreground">
            <ListTree className="icon-sm" />
            {reasoningLabel}
            <ChevronDown
              className={cn(
                "icon-xs transition-transform",
                detailsOpen && "rotate-180"
              )}
            />
          </button>
        )}
      </div>

      {context.hasDetails && detailsOpen && (
        <div
          ref={reasoningBodyRef}
          className="scroll-fade-y flex max-h-72 flex-col gap-2 overflow-y-auto rounded-panel border border-border/30 bg-background/40 px-3 py-2 text-xs leading-relaxed text-muted-foreground">
          {context.activityEvents.length > 0 && (
            <ol className="flex flex-col gap-1.5">
              {context.activityEvents.map((event) => (
                <ActivityStepRow key={event.id} event={event} t={t} />
              ))}
            </ol>
          )}
          {context.toolRuns.length > 0 && (
            <ol className="flex flex-col gap-1.5">
              {context.toolRuns.map((run) => (
                <ToolStepRow
                  key={`${run.toolId}-${run.startedAt}`}
                  run={run}
                  t={t}
                />
              ))}
            </ol>
          )}
          {context.hasThinking && (
            <details className="rounded-control border border-border/20 bg-background/45 px-2.5 py-2">
              <summary className="cursor-pointer text-2xs font-medium text-muted-foreground/80">
                {t("chat.reasoning.debug")}
              </summary>
              <ThinkingEvent content={message.thinking ?? ""} />
            </details>
          )}
        </div>
      )}
    </section>
  )
}
