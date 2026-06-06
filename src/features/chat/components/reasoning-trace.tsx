import {
  ChevronDown,
  Circle,
  FileStack,
  PanelsTopLeft,
  Search,
  Sparkles
} from "lucide-react"
import { useState } from "react"
import { useTranslation } from "react-i18next"
import { MarkdownRenderer } from "@/components/markdown-renderer"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger
} from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"
import type { ChatMessage } from "@/types"

type TraceStatus = "running" | "done" | "error"

interface TraceStep {
  key: string
  label: string
  status: TraceStatus
  icon?: React.ComponentType<{ className?: string }>
}

const statusClass = (status: TraceStatus) =>
  ({
    running: "text-app-primary",
    done: "text-muted-foreground/80",
    error: "text-status-danger"
  })[status]

const getDisplayLabel = (label: string, status: TraceStatus) =>
  status === "running" ? `${label}...` : label

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

  const steps: TraceStep[] = [
    hasThinking || isBusy
      ? {
          key: "planning",
          label: t("chat.reasoning.trace.planning"),
          status: isBusy && !message.content ? "running" : "done",
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
    ...toolRuns.map((run) => ({
      key: `tool-${run.toolId}-${run.startedAt}`,
      label:
        run.toolId === "web-search" ? t("chat.reasoning.trace.web") : run.label,
      status:
        run.status === "running"
          ? "running"
          : run.status === "error"
            ? "error"
            : "done",
      icon: run.toolId === "web-search" ? Search : Circle
    })),
    message.content || isBusy
      ? {
          key: "answering",
          label: t("chat.reasoning.trace.answering"),
          status: isBusy ? "running" : "done",
          icon: Circle
        }
      : null
  ].filter(Boolean) as TraceStep[]
  const activeStep =
    steps.find((step) => step.status === "running") ??
    steps.find((step) => step.status === "error")
  const activeLabel = activeStep
    ? getDisplayLabel(activeStep.label, activeStep.status)
    : undefined

  return (
    <section className="relative mb-2 inline-flex max-w-full items-center gap-1 rounded-chip bg-background/35 px-1 py-0.5 text-xs">
      <div className="flex min-w-0 items-center gap-0.5">
        <span className="sr-only">{t("chat.reasoning.aria_label")}</span>
        {steps.map((step) => {
          const Icon = step.icon ?? Circle
          const label = getDisplayLabel(step.label, step.status)
          return (
            <Tooltip key={step.key}>
              <TooltipTrigger
                render={
                  <span
                    className={cn(
                      "inline-flex size-7 items-center justify-center rounded-control transition-colors hover:bg-muted/45",
                      statusClass(step.status)
                    )}
                  />
                }>
                <Icon
                  className={cn(
                    "size-3.5",
                    step.status === "running" && "animate-pulse"
                  )}
                />
                <span className="sr-only">{label}</span>
              </TooltipTrigger>
              <TooltipContent>{label}</TooltipContent>
            </Tooltip>
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
        <div className="min-w-0">
          <Tooltip>
            <TooltipTrigger
              render={
                <button
                  type="button"
                  className="inline-flex size-7 items-center justify-center rounded-control text-muted-foreground transition-colors hover:bg-muted/45 hover:text-foreground"
                  aria-expanded={showDetails}
                  aria-label={t("chat.reasoning.title")}
                  onClick={() => setShowDetails((prev) => !prev)}
                />
              }>
              <ChevronDown
                className={cn(
                  "size-3.5 transition-transform",
                  showDetails && "rotate-180"
                )}
              />
            </TooltipTrigger>
            <TooltipContent>{t("chat.reasoning.title")}</TooltipContent>
          </Tooltip>
        </div>
      )}

      {hasThinking && showDetails && (
        <div className="absolute left-0 top-full z-10 mt-1 max-h-56 w-[min(32rem,calc(100vw-4rem))] overflow-y-auto rounded-panel border border-border/35 bg-popover px-3 py-2 text-[12.5px] leading-relaxed text-popover-foreground shadow-md">
          <MarkdownRenderer content={message.thinking ?? ""} />
        </div>
      )}
    </section>
  )
}
