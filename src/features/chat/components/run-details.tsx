import {
  Clock,
  FileText,
  Gauge,
  LoaderCircle,
  MessageSquare,
  Timer
} from "lucide-react"
import { useMemo } from "react"
import { useTranslation } from "react-i18next"
import {
  Popover,
  PopoverContent,
  PopoverTrigger
} from "@/components/ui/popover"
import { formatDuration, formatTokensPerSecond } from "@/lib/format-utils"
import type { ChatMessage } from "@/types"

interface RunDetailsProps {
  metrics: ChatMessage["metrics"]
}

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
            tooltip: t("chat.metrics.total_time")
          }
        : null,
      metrics.load_duration
        ? {
            key: "load",
            icon: LoaderCircle,
            label: formatDuration(metrics.load_duration),
            tooltip: t("chat.metrics.load_time")
          }
        : null,
      metrics.prompt_eval_duration
        ? {
            key: "prompt-time",
            icon: Timer,
            label: formatDuration(metrics.prompt_eval_duration),
            tooltip: t("chat.metrics.prompt_eval_time")
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
            tooltip: t("chat.metrics.generation_speed")
          }
        : null,
      metrics.eval_count
        ? {
            key: "output",
            icon: MessageSquare,
            label: metrics.eval_count.toLocaleString(),
            tooltip: t("chat.metrics.generated_tokens")
          }
        : null,
      metrics.prompt_eval_count
        ? {
            key: "input",
            icon: FileText,
            label: metrics.prompt_eval_count.toLocaleString(),
            tooltip: t("chat.metrics.prompt_tokens")
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
  const primaryValue =
    items.find((item) => item.key === "speed")?.label ?? items[0]?.label
  const metricsSummary = items
    .map((item) => `${item.tooltip}: ${item.label}`)
    .join(", ")

  return (
    <fieldset className="contents">
      <legend className="sr-only">{t("chat.metrics.generation_speed")}</legend>
      <span className="sr-only">{metricsSummary}</span>
      <Popover>
        <PopoverTrigger
          render={
            <button
              type="button"
              className="inline-flex h-6 shrink-0 items-center gap-1 whitespace-nowrap rounded-control px-1 text-[10px] text-muted-foreground transition-colors hover:bg-muted/45 hover:text-foreground"
              aria-label={metricsSummary}
            />
          }>
          <Gauge className="size-3" />
          <span className="tabular-nums">{primaryValue}</span>
        </PopoverTrigger>
        <PopoverContent className="w-56 gap-1.5 p-2" side="top" align="start">
          <div className="grid gap-1 text-xs">
            {items.map((item) => {
              const Icon = item.icon
              return (
                <div key={item.key} className="flex items-center gap-2">
                  <Icon className="size-3 text-muted-foreground" />
                  <span>{item.tooltip}</span>
                  <span className="ml-auto font-mono">{item.label}</span>
                </div>
              )
            })}
          </div>
        </PopoverContent>
      </Popover>
    </fieldset>
  )
}
