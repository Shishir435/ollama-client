import {
  Clock,
  FileText,
  Gauge,
  LoaderCircle,
  MessageSquare,
  Search,
  Timer,
  Wrench
} from "lucide-react"
import { useMemo } from "react"
import { useTranslation } from "react-i18next"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger
} from "@/components/ui/tooltip"
import { formatDuration, formatTokensPerSecond } from "@/lib/format-utils"
import { cn } from "@/lib/utils"
import type { ChatMessage } from "@/types"

interface RunDetailsProps {
  metrics: ChatMessage["metrics"]
}

const itemClass =
  "inline-flex h-6 items-center gap-1.5 rounded-chip px-1.5 text-[11px] text-muted-foreground transition-colors hover:bg-muted/45 hover:text-foreground"

export const RunDetails = ({ metrics }: RunDetailsProps) => {
  const { t } = useTranslation()
  const items = useMemo(() => {
    if (!metrics) return []
    return [
      metrics.total_duration
        ? {
            key: "time",
            icon: Clock,
            label: formatDuration(metrics.total_duration),
            tooltip: t("chat.metrics.total_duration", "Total time")
          }
        : null,
      metrics.load_duration
        ? {
            key: "load",
            icon: LoaderCircle,
            label: formatDuration(metrics.load_duration),
            tooltip: t("chat.metrics.load_duration", "Model load time")
          }
        : null,
      metrics.prompt_eval_duration
        ? {
            key: "prompt-time",
            icon: Timer,
            label: formatDuration(metrics.prompt_eval_duration),
            tooltip: t("chat.metrics.prompt_eval_duration", "Prompt eval time")
          }
        : null,
      metrics.eval_count && metrics.eval_duration
        ? {
            key: "speed",
            icon: Gauge,
            label: formatTokensPerSecond(
              metrics.eval_count,
              metrics.eval_duration
            ),
            tooltip: t("chat.metrics.eval_speed", "Generation speed")
          }
        : null,
      metrics.eval_count
        ? {
            key: "output",
            icon: MessageSquare,
            label: metrics.eval_count.toLocaleString(),
            tooltip: t(
              "chat.metrics.output_tokens",
              "{{count}} output tokens",
              {
                count: metrics.eval_count
              }
            )
          }
        : null,
      metrics.prompt_eval_count
        ? {
            key: "input",
            icon: FileText,
            label: metrics.prompt_eval_count.toLocaleString(),
            tooltip: t(
              "chat.metrics.prompt_tokens",
              "{{count}} prompt tokens",
              {
                count: metrics.prompt_eval_count
              }
            )
          }
        : null,
      metrics.ragSources?.length || metrics.usedContextChunks?.length
        ? {
            key: "context",
            icon: Search,
            label: t("chat.run_details.context_short", "ctx"),
            tooltip: t("chat.run_details.context", "Context used")
          }
        : null,
      metrics.toolRuns?.length
        ? {
            key: "tools",
            icon: Wrench,
            label: metrics.toolRuns.length.toLocaleString(),
            tooltip: t("chat.run_details.tools", "{{count}} tools", {
              count: metrics.toolRuns.length
            })
          }
        : null
    ].filter(Boolean) as Array<{
      key: string
      icon: React.ComponentType<{ className?: string }>
      label: string
      tooltip: string
    }>
  }, [metrics, t])

  if (!metrics || items.length === 0) return null

  return (
    <fieldset className="mt-2 flex flex-wrap items-center gap-x-1 gap-y-0.5 text-[11px]">
      <legend className="sr-only">
        {t("chat.run_details.title", "Run details")}
      </legend>
      {items.map((item) => {
        const Icon = item.icon
        return (
          <Tooltip key={item.key}>
            <TooltipTrigger render={<span className={cn(itemClass)} />}>
              <Icon className="size-3.5" />
              <span className="tabular-nums">{item.label}</span>
            </TooltipTrigger>
            <TooltipContent>
              <span>{item.tooltip}</span>
            </TooltipContent>
          </Tooltip>
        )
      })}
    </fieldset>
  )
}
