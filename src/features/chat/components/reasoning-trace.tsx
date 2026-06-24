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
import { MarkdownRenderer } from "@/components/markdown-renderer"
import { openOptionsInTab, runtime } from "@/lib/browser-api"
import { getToolDisplayMeta } from "@/lib/tools/tool-display"
import { cn } from "@/lib/utils"
import type { ActivityEvent, ChatMessage, ToolRun } from "@/types"

type TraceStatus = "running" | "done" | "error"

interface TraceStep {
  key: string
  label: string
  status: TraceStatus
  icon?: React.ComponentType<{ className?: string }>
  detail?: string
  preview?: string
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

const getActivityEventStatus = (event: ActivityEvent): TraceStatus =>
  event.status === "running"
    ? "running"
    : event.status === "error"
      ? "error"
      : "done"

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

const TOOL_RESULT_LIMIT_SETTINGS_PATH =
  "options.html?tab=context&focus=max-tool-result-chars"

const openToolResultLimitSettings = () => {
  void openOptionsInTab(runtime.getURL(TOOL_RESULT_LIMIT_SETTINGS_PATH))
}

const getToolRunLabel = (run: ToolRun, t: (key: string) => string): string => {
  const meta = getToolDisplayMeta(run.toolId)
  const key = run.displayNameKey ?? meta.displayNameKey
  return key ? t(key) : run.label
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
    // Only the error goes in the compact chip tooltip; full input/output/sources
    // live in the expandable details panel below to keep tooltips short.
    detail: run.error
  }
}

const getActivityCompactPreview = (
  event: ActivityEvent
): string | undefined => {
  if (event.error) return event.error
  if (event.outputPreview) return event.outputPreview
  if (event.resultCount !== undefined) {
    const sources = event.sourceTitles?.length
      ? `: ${event.sourceTitles.join(", ")}`
      : ""
    return `${event.resultCount} result${event.resultCount === 1 ? "" : "s"}${sources}`
  }
  return event.inputPreview
}

const getActivityResultPreview = (event: ActivityEvent): string | undefined => {
  if (event.outputPreview) return event.outputPreview
  if (event.resultCount !== undefined) {
    return `${event.resultCount} result${event.resultCount === 1 ? "" : "s"}`
  }
  return undefined
}

const buildActivityTraceStep = (event: ActivityEvent): TraceStep => ({
  key: `activity-${event.id}`,
  label: event.label,
  status: getActivityEventStatus(event),
  icon: ACTIVITY_ICONS[event.kind] ?? Circle,
  detail: event.error,
  preview: getActivityCompactPreview(event)
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
  const activityEvents = message.metrics?.activityEvents ?? []
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
    activityEvents.length > 0 ||
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
  const [detailsOpen, setDetailsOpen] = useState(false)
  // Once the user clicks the toggle we stop auto-managing the open state.
  const userControlledRef = useRef(false)
  const autoOpenedRef = useRef(false)
  const autoCollapsedRef = useRef(false)
  const reasoningBodyRef = useRef<HTMLDivElement>(null)
  const hasThinking = Boolean(message.thinking?.trim())
  const activityEvents = message.metrics?.activityEvents ?? []
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

  const hasVisibleContent = Boolean(message.content?.trim())
  const isThinkingOnlyFallback = message.metrics?.thinkingOnlyResponse === true
  const hasActivityDetails = activityEvents.length > 0 || toolRuns.length > 0
  const hasDetails = hasActivityDetails || hasThinking

  // Edge-trigger auto state. Streaming updates tool status/thinking on every
  // chunk; deriving open/closed from those volatile values makes the panel
  // visibly flicker. Open once when work starts, collapse once when answer text
  // appears, then leave user clicks in control.
  useEffect(() => {
    if (userControlledRef.current) return
    if (isThinkingOnlyFallback && hasDetails && !autoOpenedRef.current) {
      autoOpenedRef.current = true
      setDetailsOpen(true)
      return
    }
    if (
      isBusy &&
      hasActivityDetails &&
      !hasVisibleContent &&
      !autoOpenedRef.current
    ) {
      autoOpenedRef.current = true
      setDetailsOpen(true)
      return
    }
    if (
      hasVisibleContent &&
      !isThinkingOnlyFallback &&
      !autoCollapsedRef.current
    ) {
      autoCollapsedRef.current = true
      setDetailsOpen(false)
    }
  }, [
    isBusy,
    hasDetails,
    hasVisibleContent,
    isThinkingOnlyFallback,
    hasActivityDetails
  ])

  const toggleDetails = () => {
    userControlledRef.current = true
    setDetailsOpen((open) => !open)
  }

  // Keep the live reasoning scrolled to the latest line while it streams.
  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll on thinking growth
  useEffect(() => {
    if (detailsOpen && isBusy && reasoningBodyRef.current) {
      reasoningBodyRef.current.scrollTop = reasoningBodyRef.current.scrollHeight
    }
  }, [
    message.thinking,
    activityEvents.length,
    toolRuns.length,
    detailsOpen,
    isBusy
  ])

  if (!shouldShowReasoningTrace(message, isLoading, isStreaming)) {
    return null
  }

  const steps: TraceStep[] = [
    ...activityEvents.map(buildActivityTraceStep),
    isBusy && !hasVisibleContent && activityEvents.length === 0
      ? {
          key: "thinking",
          label: t("chat.reasoning.trace.preparing"),
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
    (!hasVisibleContent
      ? steps.find((step) => step.status === "error")
      : undefined)
  const activeLabel = activeStep
    ? activeStep.status === "error" && activeStep.detail
      ? `${activeStep.label}: ${activeStep.detail}`
      : activeStep.preview
        ? `${getDisplayLabel(activeStep.label, activeStep.status)}: ${activeStep.preview}`
        : getDisplayLabel(activeStep.label, activeStep.status)
    : undefined

  const reasoningLabel = t("chat.reasoning.title")

  return (
    <section className="mb-2 flex max-w-full flex-col gap-1 text-xs">
      <div className="inline-flex min-w-0 max-w-full items-center gap-1 overflow-hidden rounded-chip bg-background/35 px-1 py-0.5">
        <div className="flex shrink-0 items-center gap-0.5">
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
              "min-w-0 flex-1 truncate pr-1 text-[11px]",
              activeStep?.status === "error"
                ? "text-status-danger"
                : "text-muted-foreground"
            )}>
            {activeLabel}
          </span>
        )}

        {hasDetails && (
          <button
            type="button"
            onClick={toggleDetails}
            aria-expanded={detailsOpen}
            className="inline-flex h-7 shrink-0 items-center gap-0.5 whitespace-nowrap rounded-control px-1.5 text-[11px] text-muted-foreground transition-colors hover:bg-muted/45 hover:text-foreground">
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

      {hasDetails && detailsOpen && (
        <div
          ref={reasoningBodyRef}
          className="flex max-h-72 flex-col gap-2 overflow-y-auto rounded-panel border border-border/30 bg-background/40 px-3 py-2 text-[12.5px] leading-relaxed text-muted-foreground">
          {activityEvents.length > 0 && (
            <ol className="flex flex-col gap-1.5">
              {activityEvents.map((event) => (
                <ActivityStepRow key={event.id} event={event} />
              ))}
            </ol>
          )}
          {toolRuns.length > 0 && (
            <ol className="flex flex-col gap-1.5">
              {toolRuns.map((run) => (
                <ToolStepRow
                  key={`${run.toolId}-${run.startedAt}`}
                  run={run}
                  t={t}
                />
              ))}
            </ol>
          )}
          {hasThinking && (
            <details className="rounded-control border border-border/20 bg-background/45 px-2.5 py-2">
              <summary className="cursor-pointer text-[11px] font-medium text-muted-foreground/80">
                {t("chat.reasoning.debug")}
              </summary>
              <div className="mt-1 text-[11px] text-muted-foreground/70">
                <MarkdownRenderer content={message.thinking ?? ""} />
              </div>
            </details>
          )}
        </div>
      )}
    </section>
  )
}

/** One inspectable app activity step: user-facing work, never raw reasoning. */
const ActivityStepRow = ({ event }: { event: ActivityEvent }) => {
  const status = getActivityEventStatus(event)
  const resultPreview = getActivityResultPreview(event)
  return (
    <li className="rounded-control border border-border/20 bg-background/45 px-2.5 py-2">
      <div className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5">
        <span
          className={cn(
            "shrink-0 whitespace-nowrap font-medium",
            statusClass(status)
          )}>
          {event.label}
          {status === "running" ? "…" : ""}
        </span>
        {event.resultCount !== undefined && (
          <span className="text-[10.5px] text-muted-foreground/70">
            · {event.resultCount} result{event.resultCount === 1 ? "" : "s"}
          </span>
        )}
      </div>
      {event.inputPreview && (
        <div className="mt-0.5 wrap-break-word font-mono text-[11px] text-muted-foreground/80">
          {event.inputPreview}
        </div>
      )}
      {event.error ? (
        <div className="mt-0.5 text-[11px] text-status-danger">
          {event.error}
        </div>
      ) : (
        resultPreview && (
          <div className="mt-0.5 wrap-break-word text-[11px] text-muted-foreground/70">
            {resultPreview}
          </div>
        )
      )}
      {event.sourceTitles && event.sourceTitles.length > 0 && (
        <div className="mt-0.5 text-[11px] text-muted-foreground/80">
          {event.sourceTitles.join(", ")}
        </div>
      )}
    </li>
  )
}

/** One inspectable tool step: name + status, with its input args and output. */
const ToolStepRow = ({
  run,
  t
}: {
  run: ToolRun
  t: (key: string) => string
}) => {
  const status = getToolRunStatus(run)
  const argEntries = run.args ? Object.entries(run.args) : []
  return (
    <li className="rounded-control border border-border/20 bg-background/45 px-2.5 py-2">
      <div className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5">
        <span
          className={cn(
            "shrink-0 whitespace-nowrap font-medium",
            statusClass(status)
          )}>
          {getToolRunLabel(run, t)}
          {status === "running" ? "…" : ""}
        </span>
        {run.truncated && (
          <span className="min-w-0 text-[10.5px] text-muted-foreground/70">
            · {t("chat.reasoning.trace.trimmed")}{" "}
            <button
              type="button"
              onClick={openToolResultLimitSettings}
              className="rounded-sm text-app-primary underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring">
              {t("chat.reasoning.trace.change_limit")}
            </button>
          </span>
        )}
      </div>
      {argEntries.length > 0 && (
        <div className="mt-0.5 wrap-break-word font-mono text-[11px] text-muted-foreground/80">
          {argEntries
            .map(([key, value]) => `${key}: ${JSON.stringify(value)}`)
            .join(", ")}
        </div>
      )}
      {run.error ? (
        <div className="mt-0.5 text-[11px] text-status-danger">{run.error}</div>
      ) : run.sources?.length ? (
        <div className="mt-0.5 text-[11px] text-muted-foreground/80">
          {run.sources.map((source) => source.title).join(", ")}
        </div>
      ) : (
        run.resultPreview && (
          <div className="mt-0.5 wrap-break-word text-[11px] text-muted-foreground/70">
            {run.resultPreview}
            {run.resultPreview.length >= 240 ? "…" : ""}
          </div>
        )
      )}
    </li>
  )
}
