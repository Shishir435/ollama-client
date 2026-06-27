import {
  Clock,
  FileText,
  type LucideIcon,
  MessageSquare,
  Zap
} from "lucide-react"
import { useMemo } from "react"
import { useTranslation } from "react-i18next"
import {
  Popover,
  PopoverContent,
  PopoverTrigger
} from "@/components/ui/popover"
import {
  calculateSessionMetrics,
  formatSessionDuration
} from "@/features/chat/lib/session-metrics-utils"

import { cn } from "@/lib/utils"
import type { ChatMessage } from "@/types"

interface MetricItem {
  icon: LucideIcon
  iconColor: string
  value: string
  isAvailable?: boolean
  labelKey: string
  tooltipKey: string
}

export interface SessionMetricsBarProps {
  messages: ChatMessage[]
  className?: string
}

export const SessionMetricsBar = ({
  messages,
  className
}: SessionMetricsBarProps) => {
  const { t } = useTranslation()

  const metrics = useMemo(() => calculateSessionMetrics(messages), [messages])

  if (metrics.messageCount === 0) {
    return null
  }

  const metricItems: MetricItem[] = [
    {
      icon: FileText,
      iconColor: "text-muted-foreground",
      value: metrics.totalTokens.toLocaleString(),
      labelKey: "chat.session_metrics.label_tokens",
      tooltipKey: "chat.session_metrics.tooltip_tokens"
    },
    {
      icon: Clock,
      iconColor: "text-muted-foreground",
      value: formatSessionDuration(metrics.totalDuration),
      labelKey: "chat.session_metrics.label_time",
      tooltipKey: "chat.session_metrics.tooltip_time"
    },
    {
      icon: Zap,
      iconColor: "text-muted-foreground",
      value:
        metrics.averageSpeed > 0
          ? `${metrics.averageSpeed.toFixed(1)} ${t("chat.metrics.speed_unit")}`
          : "—",
      isAvailable: metrics.averageSpeed > 0,
      labelKey: "chat.session_metrics.label_speed",
      tooltipKey: "chat.session_metrics.tooltip_speed"
    },
    {
      icon: MessageSquare,
      iconColor: "text-muted-foreground",
      value: String(metrics.messageCount),
      labelKey: "chat.session_metrics.label_responses",
      tooltipKey: "chat.session_metrics.tooltip_messages"
    }
  ]
  const summaryItem =
    metricItems.find(
      (item) => item.tooltipKey.includes("speed") && item.isAvailable
    ) ?? metricItems[0]
  const SummaryIcon = summaryItem.icon
  const label = t("settings.chat_display.session_metrics_label")

  return (
    <Popover>
      <PopoverTrigger
        render={
          <button
            type="button"
            className={cn(
              "inline-flex h-8 items-center gap-1.5 rounded-control px-2 text-2xs text-muted-foreground transition-colors hover:bg-muted/55 hover:text-foreground",
              className
            )}
            aria-label={`${label}: ${t(summaryItem.labelKey)} ${summaryItem.value}`}
          />
        }>
        <SummaryIcon className="icon-sm" />
        <span className="font-mono tabular-nums">{summaryItem.value}</span>
      </PopoverTrigger>
      <PopoverContent
        align="center"
        sideOffset={8}
        className="w-[min(14rem,calc(100vw-1rem))] rounded-panel p-2">
        <div className="grid gap-1 text-xs">
          {metricItems.map((item) => {
            const Icon = item.icon

            return (
              <div key={item.tooltipKey} className="flex items-center gap-2">
                <Icon className={cn("icon-sm", item.iconColor)} />
                <span className="min-w-0 truncate">{t(item.labelKey)}</span>
                <span className="ml-auto shrink-0 font-mono tabular-nums">
                  {item.value}
                </span>
              </div>
            )
          })}
        </div>
      </PopoverContent>
    </Popover>
  )
}
