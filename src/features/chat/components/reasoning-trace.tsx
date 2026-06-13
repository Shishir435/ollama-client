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
import { useEffect, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { TooltipActionButton } from "@/components/actions"
import { MarkdownRenderer } from "@/components/markdown-renderer"
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

const getToolRunDetail = (run: ToolRun, t: (key: string) => string) => {
  const parts: string[] = []
  if (run.error) parts.push(run.error)
  else if (run.sources?.length) {
    parts.push(run.sources.map((source) => source.title).join(", "))
  }
  if (run.truncated) parts.push(t("chat.reasoning.trace.trimmed"))
  return parts.length > 0 ? parts.join(" · ") : undefined
}

const buildToolTraceStep = (
  run: ToolRun,
  t: (key: string) => string
): TraceStep => ({
  key: `tool-${run.toolId}-${run.startedAt}`,
  label: getToolRunLabel(run, t),
  status: getToolRunStatus(run),
  icon: TOOL_ICONS[run.toolId] ?? Circle,
  detail: getToolRunDetail(run, t)
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
  // null = follow auto behavior; true/false = user explicitly toggled.
  const [userToggled, setUserToggled] = useState<boolean | null>(null)
  const reasoningBodyRef = useRef<HTMLDivElement>(null)
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

  const hasVisibleContent = Boolean(message.content?.trim())
  const toolRunning = toolRuns.some((run) => run.status === "running")
  const hasDetails = hasThinking || toolRuns.length > 0
  // Auto-expand the details (reasoning + tool steps) while the model is still
  // working and hasn't produced an answer yet, so live reasoning and running
  // tools are visible; collapse once the answer starts streaming. The user can
  // override either way; once they do we respect their choice.
  const autoOpenDetails =
    isBusy && hasDetails && (!hasVisibleContent || toolRunning)
  const detailsOpen = userToggled ?? autoOpenDetails

  // Keep the live reasoning scrolled to the latest line while it streams.
  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll on thinking growth
  useEffect(() => {
    if (detailsOpen && isBusy && reasoningBodyRef.current) {
      reasoningBodyRef.current.scrollTop = reasoningBodyRef.current.scrollHeight
    }
  }, [message.thinking, toolRuns.length, detailsOpen, isBusy])

  if (!shouldShowReasoningTrace(message, isLoading, isStreaming)) {
    return null
  }

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

  const reasoningLabel =
    isBusy && !hasVisibleContent
      ? t("chat.reasoning.trace.thinking")
      : t("chat.reasoning.title")

  return (
    <section className="mb-2 flex max-w-full flex-col gap-1 text-xs">
      <div className="inline-flex max-w-full items-center gap-1 self-start rounded-chip bg-background/35 px-1 py-0.5">
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

        {hasDetails && (
          <button
            type="button"
            onClick={() => setUserToggled(!detailsOpen)}
            aria-expanded={detailsOpen}
            className="inline-flex h-7 items-center gap-0.5 rounded-control px-1.5 text-[11px] text-muted-foreground transition-colors hover:bg-muted/45 hover:text-foreground">
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
          {hasThinking && <MarkdownRenderer content={message.thinking ?? ""} />}
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
        </div>
      )}
    </section>
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
    <li className="rounded-control bg-muted/20 px-2 py-1.5">
      <div className="flex items-center gap-1.5">
        <span className={cn("font-medium", statusClass(status))}>
          {getToolRunLabel(run, t)}
          {status === "running" ? "…" : ""}
        </span>
        {run.truncated && (
          <span className="text-[10.5px] text-muted-foreground/70">
            · {t("chat.reasoning.trace.trimmed")}
          </span>
        )}
      </div>
      {argEntries.length > 0 && (
        <div className="mt-0.5 break-words font-mono text-[11px] text-muted-foreground/80">
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
          <div className="mt-0.5 break-words text-[11px] text-muted-foreground/70">
            {run.resultPreview}
            {run.resultPreview.length >= 240 ? "…" : ""}
          </div>
        )
      )}
    </li>
  )
}
