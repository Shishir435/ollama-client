import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  CircleDashed,
  Clock,
  Loader2,
  MousePointer2,
  Search,
  XCircle
} from "lucide-react"
import { useState } from "react"
import type {
  AgentStatus,
  AgentStep,
  AgentWaitContext
} from "@/lib/agent/types"
import { cn } from "@/lib/utils"

interface AgentStepDisplayProps {
  steps: AgentStep[]
  status: AgentStatus
  finalMessage?: string
  elapsedMs?: number
  isSlow?: boolean
  waitContext?: AgentWaitContext
  agentMode?: "tool-calling" | "json-fallback"
  onStop?: () => void
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const formatElapsed = (ms: number): string => {
  if (ms < 1000) return `${ms}ms`
  const s = Math.floor(ms / 1000)
  if (s < 60) return `${s}s`
  return `${Math.floor(s / 60)}m ${s % 60}s`
}

const ActionIcon = ({ type }: { type: string }) => {
  switch (type) {
    case "click_element":
      return <MousePointer2 className="h-3 w-3" />
    case "fill_input":
      return <span className="text-[10px] font-bold">ABC</span>
    case "get_interactive_elements":
      return <Search className="h-3 w-3" />
    case "scroll_page":
      return <span className="text-[10px]">↕</span>
    case "get_page_content":
      return <span className="text-[10px]">📄</span>
    case "wait":
      return <CircleDashed className="h-3 w-3" />
    case "navigate_to":
      return <span className="text-[10px]">🔗</span>
    case "control_video":
      return <span className="text-[10px]">VID</span>
    case "wait_for_video_end":
      return <Clock className="h-3 w-3" />
    case "advance_to_next_video":
      return <span className="text-[10px]">NEXT</span>
    case "task_complete":
      return <CheckCircle2 className="h-3 w-3" />
    default:
      return <CircleDashed className="h-3 w-3" />
  }
}

const actionLabel = (type: string, args: Record<string, unknown>): string => {
  switch (type) {
    case "get_interactive_elements":
      return "Scanning page elements..."
    case "click_element":
      return `Clicking element #${args.element_id}`
    case "fill_input":
      return `Typing "${String(args.value || "").slice(0, 30)}" in #${args.element_id}`
    case "select_option":
      return `Selecting "${args.value}" in #${args.element_id}`
    case "scroll_page":
      return `Scrolling ${args.direction}`
    case "get_page_content":
      return "Reading page content..."
    case "wait":
      return `Waiting ${args.ms}ms...`
    case "navigate_to":
      return `Navigating to ${String(args.url || "").slice(0, 40)}`
    case "control_video":
      return `Setting video to ${String(args.state || "toggle")}`
    case "wait_for_video_end":
      return "Waiting for the current video to finish..."
    case "advance_to_next_video":
      return "Opening the next lesson or video..."
    case "task_complete":
      return "Task complete"
    default:
      return type
  }
}

// ─── Component ────────────────────────────────────────────────────────────────

export const AgentStepDisplay = ({
  steps,
  status,
  finalMessage,
  elapsedMs = 0,
  isSlow = false,
  waitContext,
  agentMode,
  onStop
}: AgentStepDisplayProps) => {
  const [expanded, setExpanded] = useState(true)
  const isRunning = status === "running"
  const isError = status === "error"
  const isDone = status === "done"
  const isStopped = status === "stopped"
  const isWaitingVideo = isRunning && waitContext === "video_playback"

  const borderColor = isWaitingVideo
    ? "border-sky-500/40 bg-sky-500/5"
    : isSlow && isRunning
      ? "border-amber-500/40 bg-amber-500/5"
      : isRunning
        ? "border-violet-500/30 bg-violet-500/5"
        : isDone
          ? "border-emerald-500/30 bg-emerald-500/5"
          : isError || isStopped
            ? "border-destructive/30 bg-destructive/5"
            : "border-border/40 bg-muted/20"

  const headerLabel = (() => {
    if (isWaitingVideo) return `Watching video - ${formatElapsed(elapsedMs)}`
    if (isRunning && isSlow)
      return `Agent slow — waiting ${formatElapsed(elapsedMs)}`
    if (isRunning)
      return `Agent running — step ${steps.length} (${formatElapsed(elapsedMs)})`
    if (isDone)
      return `Completed in ${steps.length} steps (${formatElapsed(elapsedMs)})`
    if (isStopped) return "Agent stopped"
    if (isError) return "Agent error"
    return "Agent"
  })()

  return (
    <div
      className={cn(
        "mx-2 mb-2 overflow-hidden rounded-xl border transition-all duration-300",
        borderColor
      )}>
      {/* ── Header ── */}
      <button
        type="button"
        className="flex w-full cursor-pointer items-center justify-between px-3 py-2 text-left"
        onClick={() => setExpanded(!expanded)}>
        <div className="flex items-center gap-2">
          {isWaitingVideo ? (
            <Clock className="h-3.5 w-3.5 text-sky-500" />
          ) : isRunning && isSlow ? (
            <AlertTriangle className="h-3.5 w-3.5 animate-pulse text-amber-500" />
          ) : isRunning ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin text-violet-500" />
          ) : isDone ? (
            <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
          ) : isError ? (
            <XCircle className="h-3.5 w-3.5 text-destructive" />
          ) : (
            <CircleDashed className="h-3.5 w-3.5 text-muted-foreground" />
          )}

          <span
            className={cn(
              "text-xs font-semibold",
              isWaitingVideo
                ? "text-sky-600 dark:text-sky-400"
                : isSlow && isRunning
                  ? "text-amber-600 dark:text-amber-400"
                  : "text-foreground"
            )}>
            {headerLabel}
          </span>

          {/* Mode badge */}
          {agentMode && (
            <span
              className={cn(
                "rounded-full px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide",
                agentMode === "json-fallback"
                  ? "bg-amber-500/15 text-amber-600 dark:text-amber-400"
                  : "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
              )}>
              {agentMode === "json-fallback" ? "JSON fallback" : "Tool calling"}
            </span>
          )}

          {/* Elapsed clock pill when running */}
          {isRunning && !isSlow && !isWaitingVideo && (
            <span className="flex items-center gap-1 rounded-full bg-violet-500/10 px-1.5 py-0.5 text-[10px] text-violet-500">
              <Clock className="h-2.5 w-2.5" />
              {formatElapsed(elapsedMs)}
            </span>
          )}
          {isWaitingVideo && (
            <span className="flex items-center gap-1 rounded-full bg-sky-500/10 px-1.5 py-0.5 text-[10px] text-sky-600 dark:text-sky-400">
              <Clock className="h-2.5 w-2.5" />
              {formatElapsed(elapsedMs)}
            </span>
          )}
        </div>

        <div className="flex items-center gap-1.5">
          {isRunning && onStop && (
            <button
              id="agent-stop-button"
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                onStop()
              }}
              className="rounded-md bg-destructive/10 px-2 py-0.5 text-[10px] font-semibold text-destructive hover:bg-destructive/20">
              Stop
            </button>
          )}
          {expanded ? (
            <ChevronUp className="h-3 w-3 text-muted-foreground" />
          ) : (
            <ChevronDown className="h-3 w-3 text-muted-foreground" />
          )}
        </div>
      </button>

      {/* ── Slow / Hung warning banner ── */}
      {isWaitingVideo && expanded && (
        <div className="mx-3 mb-2 flex items-start gap-2 rounded-lg bg-sky-500/10 px-3 py-2 text-[11px] text-sky-700 dark:text-sky-400">
          <Clock className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>
            The agent is waiting for the current video to finish before moving
            to the next lesson.
          </span>
        </div>
      )}
      {isRunning && isSlow && !isWaitingVideo && expanded && (
        <div className="mx-3 mb-2 flex items-start gap-2 rounded-lg bg-amber-500/10 px-3 py-2 text-[11px] text-amber-700 dark:text-amber-400">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>
            The model hasn't responded in {Math.floor(elapsedMs / 1000)}s. It
            may be loading into memory or processing a complex request.{" "}
            {elapsedMs > 45_000 && (
              <strong>Check that Ollama is running in your terminal.</strong>
            )}
          </span>
        </div>
      )}

      {/* ── Steps list ── */}
      {expanded && (
        <div className="max-h-52 overflow-y-auto px-3 pb-2">
          <div className="flex flex-col gap-1.5">
            {steps.map((step) => {
              const action = step.action
              const actionType = action?.type || ""
              const args = action
                ? {
                    element_id: action.element_id,
                    value: action.value,
                    direction: action.direction,
                    url: action.url,
                    ms: action.ms,
                    message: action.message,
                    state: action.state
                  }
                : {}

              return (
                <div key={step.stepNumber} className="flex items-start gap-2">
                  {/* Step indicator dot */}
                  <div
                    className={cn(
                      "mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[10px]",
                      step.result?.success
                        ? "bg-emerald-500/15 text-emerald-500"
                        : step.result
                          ? "bg-destructive/15 text-destructive"
                          : "bg-violet-500/15 text-violet-500"
                    )}>
                    <ActionIcon type={actionType} />
                  </div>

                  <div className="min-w-0 flex-1">
                    {step.thought && (
                      <p className="text-[10px] italic text-muted-foreground">
                        💭 {step.thought.slice(0, 100)}
                        {step.thought.length > 100 ? "…" : ""}
                      </p>
                    )}
                    {action && (
                      <p className="text-[11px] text-foreground">
                        {actionLabel(
                          actionType,
                          args as Record<string, unknown>
                        )}
                      </p>
                    )}
                    {step.result && !step.result.success && (
                      <p className="mt-0.5 text-[10px] text-destructive">
                        ✗ {step.result.message.slice(0, 100)}
                      </p>
                    )}
                    {step.result?.success && (
                      <p className="mt-0.5 text-[10px] text-emerald-600 dark:text-emerald-400">
                        ✓ {step.result.message.slice(0, 80)}
                      </p>
                    )}
                  </div>
                </div>
              )
            })}

            {/* "Thinking…" row while waiting for next step */}
            {isRunning && (
              <div className="flex items-center gap-2 opacity-70">
                <Loader2
                  className={cn(
                    "h-3 w-3 shrink-0",
                    isWaitingVideo
                      ? "animate-pulse text-sky-500"
                      : isSlow
                        ? "animate-pulse text-amber-500"
                        : "animate-spin text-violet-500"
                  )}
                />
                <span
                  className={cn(
                    "text-[11px]",
                    isWaitingVideo
                      ? "text-sky-600 dark:text-sky-400"
                      : isSlow
                        ? "text-amber-500"
                        : "text-violet-500"
                  )}>
                  {isWaitingVideo
                    ? "Watching current lesson..."
                    : isSlow
                      ? "Waiting for model..."
                      : "Thinking..."}
                </span>
              </div>
            )}
          </div>

          {/* Final message  */}
          {finalMessage && !isRunning && (
            <div
              className={cn(
                "mt-2 rounded-lg p-2 text-[11px] leading-relaxed",
                isDone
                  ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
                  : "bg-destructive/10 text-destructive"
              )}>
              {finalMessage}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
