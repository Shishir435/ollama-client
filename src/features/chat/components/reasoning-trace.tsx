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

export interface ReasoningTraceProps {
  message: ChatMessage
  isLoading?: boolean
  isStreaming?: boolean
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
  const hasFileContext =
    Boolean(message.metrics?.ragSources?.length) ||
    Boolean(message.attachments?.length)
  const hasPageContext =
    Boolean(message.metrics?.usedContextChunks?.length) ||
    Boolean(message.metrics?.tabContextLength)
  const isBusy = isLoading || isStreaming

  if (
    !hasThinking &&
    !isBusy &&
    toolRuns.length === 0 &&
    !hasFileContext &&
    !hasPageContext
  ) {
    return null
  }

  const steps: TraceStep[] = [
    hasThinking || isBusy
      ? {
          key: "planning",
          label: t("chat.reasoning.trace.planning", "Planning"),
          status: isBusy && !message.content ? "running" : "done",
          icon: Sparkles
        }
      : null,
    hasPageContext
      ? {
          key: "page",
          label: t("chat.reasoning.trace.page", "Reading page"),
          status: "done",
          icon: PanelsTopLeft
        }
      : null,
    hasFileContext
      ? {
          key: "files",
          label: t("chat.reasoning.trace.files", "Using files"),
          status: "done",
          icon: FileStack
        }
      : null,
    ...toolRuns.map((run) => ({
      key: `tool-${run.toolId}-${run.startedAt}`,
      label:
        run.toolId === "web-search"
          ? t("chat.reasoning.trace.web", "Searching web")
          : run.label,
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
          label: t("chat.reasoning.trace.answering", "Answering"),
          status: isBusy ? "running" : "done",
          icon: Circle
        }
      : null
  ].filter(Boolean) as TraceStep[]

  return (
    <section className="mb-3 rounded-panel border border-border/35 bg-surface-message/70 text-xs">
      <div className="flex flex-wrap gap-1.5 px-2.5 py-2">
        {steps.map((step) => {
          const Icon = step.icon ?? Circle
          return (
            <div
              key={step.key}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-chip bg-background/50 px-2 py-1 font-medium",
                statusClass(step.status)
              )}>
              <Icon
                className={cn(
                  "size-3",
                  step.status === "running" && "animate-pulse"
                )}
              />
              <span>{step.label}</span>
            </div>
          )
        })}
      </div>

      {hasThinking && (
        <div className="border-t border-border/25">
          <button
            type="button"
            className="flex w-full items-center justify-between px-2.5 py-2 text-left text-[11px] font-medium text-muted-foreground hover:text-foreground"
            aria-expanded={showDetails}
            onClick={() => setShowDetails((prev) => !prev)}>
            <span>{t("chat.reasoning.details", "Reasoning details")}</span>
            <ChevronDown
              className={cn(
                "size-3 transition-transform",
                showDetails && "rotate-180"
              )}
            />
          </button>
          {showDetails && (
            <div className="max-h-56 overflow-y-auto border-t border-border/20 px-3 py-2 text-[12.5px] leading-relaxed text-muted-foreground/90">
              <MarkdownRenderer content={message.thinking ?? ""} />
            </div>
          )}
        </div>
      )}
    </section>
  )
}
