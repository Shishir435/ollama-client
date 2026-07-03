import { MarkdownRenderer } from "@/components/markdown-renderer"
import { openOptionsInTab, runtime } from "@/lib/browser-api"
import { getToolDisplayMeta } from "@/lib/tools/tool-display"
import { cn } from "@/lib/utils"
import type { ActivityEvent, ToolRun } from "@/types"

export type TraceStatus = "running" | "done" | "error"

export const statusClass = (status: TraceStatus) =>
  ({
    running: "text-app-primary",
    done: "text-muted-foreground/80",
    error: "text-status-danger"
  })[status]

export const getToolRunStatus = (run: ToolRun): TraceStatus =>
  run.status === "running"
    ? "running"
    : run.status === "error"
      ? "error"
      : "done"

export const getActivityEventStatus = (event: ActivityEvent): TraceStatus =>
  event.status === "running"
    ? "running"
    : event.status === "error"
      ? "error"
      : "done"

export const getToolRunLabel = (
  run: ToolRun,
  t: (key: string) => string
): string => {
  const meta = getToolDisplayMeta(run.toolId)
  const key = run.displayNameKey ?? meta.displayNameKey
  return key ? t(key) : run.label
}

const getActivityResultPreview = (event: ActivityEvent): string | undefined => {
  if (event.outputPreview) return event.outputPreview
  if (event.resultCount !== undefined) {
    return `${event.resultCount} result${event.resultCount === 1 ? "" : "s"}`
  }
  return undefined
}

const TOOL_RESULT_LIMIT_SETTINGS_PATH =
  "options.html?tab=knowledge&focus=max-tool-result-chars"

const openToolResultLimitSettings = () => {
  void openOptionsInTab(runtime.getURL(TOOL_RESULT_LIMIT_SETTINGS_PATH))
}

/** One inspectable app event. User-facing work only, never raw reasoning. */
export const ActivityStepRow = ({ event }: { event: ActivityEvent }) => {
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
        </span>
        {event.resultCount !== undefined && (
          <span className="text-micro text-muted-foreground/70">
            · {event.resultCount} result{event.resultCount === 1 ? "" : "s"}
          </span>
        )}
      </div>
      {event.inputPreview && (
        <div className="mt-0.5 wrap-break-word font-mono text-2xs text-muted-foreground/80">
          {event.inputPreview}
        </div>
      )}
      {event.error ? (
        <div className="mt-0.5 text-2xs text-status-danger">{event.error}</div>
      ) : (
        resultPreview && (
          <div className="mt-0.5 wrap-break-word text-2xs text-muted-foreground/70">
            {resultPreview}
          </div>
        )
      )}
      {event.sourceTitles && event.sourceTitles.length > 0 && (
        <div className="mt-0.5 text-2xs text-muted-foreground/80">
          {event.sourceTitles.join(", ")}
        </div>
      )}
    </li>
  )
}

/** One inspectable tool event with normalized input/output rendering. */
export const ToolStepRow = ({
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
          <span className="min-w-0 text-micro text-muted-foreground/70">
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
        <div className="mt-0.5 wrap-break-word font-mono text-2xs text-muted-foreground/80">
          {argEntries
            .map(([key, value]) => `${key}: ${JSON.stringify(value)}`)
            .join(", ")}
        </div>
      )}
      {run.error ? (
        <div className="mt-0.5 text-2xs text-status-danger">{run.error}</div>
      ) : run.sources?.length ? (
        <div className="mt-0.5 text-2xs text-muted-foreground/80">
          {run.sources.map((source) => source.title).join(", ")}
        </div>
      ) : (
        run.resultPreview && (
          <div className="mt-0.5 wrap-break-word text-2xs text-muted-foreground/70">
            {run.resultPreview}
            {run.resultPreview.length >= 240 ? "…" : ""}
          </div>
        )
      )}
    </li>
  )
}

export const ThinkingEvent = ({ content }: { content: string }) => (
  <div className="mt-1 text-2xs text-muted-foreground/70">
    <MarkdownRenderer content={content} />
  </div>
)
