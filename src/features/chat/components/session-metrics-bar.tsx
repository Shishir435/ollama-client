import { useMemo } from "react"
import { useTranslation } from "react-i18next"

import { Separator } from "@/components/ui/separator"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger
} from "@/components/ui/tooltip"
import {
  calculateSessionMetrics,
  formatSessionDuration
} from "@/features/chat/lib/session-metrics-utils"
import {
  Activity,
  Clock,
  type LucideIcon,
  MessageSquare,
  Sparkles
} from "@/lib/lucide-icon"
import { cn } from "@/lib/utils"
import type { ChatMessage } from "@/types"

interface MetricItem {
  icon: LucideIcon
  iconColor: string
  value: string
  translationKey: string
  tooltipKey: string
  defaultValue: string
  defaultTooltip: string
}

interface SessionMetricsBarProps {
  messages: ChatMessage[]
  className?: string
}

export const SessionMetricsBar = ({
  messages,
  className
}: SessionMetricsBarProps) => {
  const { t } = useTranslation()

  const metrics = useMemo(() => calculateSessionMetrics(messages), [messages])

  // Don't show if no messages have metrics yet
  if (metrics.messageCount === 0) {
    return null
  }

  const metricItems: MetricItem[] = [
    {
      icon: Sparkles,
      iconColor: "text-purple-500",
      value: metrics.totalTokens.toLocaleString(),
      translationKey: "chat.session_metrics.total_tokens",
      tooltipKey: "chat.session_metrics.tooltip_tokens",
      defaultValue: `${metrics.totalTokens.toLocaleString()} tokens`,
      defaultTooltip: "Total tokens used in this session"
    },
    {
      icon: Clock,
      iconColor: "text-blue-500",
      value: formatSessionDuration(metrics.totalDuration),
      translationKey: "",
      tooltipKey: "chat.session_metrics.tooltip_time",
      defaultValue: formatSessionDuration(metrics.totalDuration),
      defaultTooltip: "Total response generation time"
    },
    {
      icon: Activity,
      iconColor: "text-emerald-500",
      value: metrics.averageSpeed.toFixed(1),
      translationKey: "chat.session_metrics.avg_speed",
      tooltipKey: "chat.session_metrics.tooltip_speed",
      defaultValue: `${metrics.averageSpeed.toFixed(1)} t/s`,
      defaultTooltip: "Average generation speed"
    },
    {
      icon: MessageSquare,
      iconColor: "text-amber-500",
      value: String(metrics.messageCount),
      translationKey: "chat.session_metrics.messages",
      tooltipKey: "chat.session_metrics.tooltip_messages",
      defaultValue: `${metrics.messageCount} msgs`,
      defaultTooltip: "Number of AI responses"
    }
  ]

  return (
    <div
      className={cn(
        "mb-2 flex w-full items-center justify-center gap-3 rounded-lg border border-border/40 bg-muted/30 px-3 py-1.5 text-xs text-muted-foreground",
        className
      )}>
      {metricItems.map((item, index) => {
        const Icon = item.icon
        const displayValue = item.translationKey
          ? t(item.translationKey, {
              value: item.value,
              speed: item.value,
              defaultValue: item.defaultValue
            })
          : item.defaultValue

        return (
          <div key={item.tooltipKey} className="flex items-center gap-3">
            <Tooltip>
              <TooltipTrigger asChild>
                <div className="flex items-center gap-1.5">
                  <Icon className={cn("size-3", item.iconColor)} />
                  <span className="font-mono">{displayValue}</span>
                </div>
              </TooltipTrigger>
              <TooltipContent>
                <p>
                  {t(item.tooltipKey, { defaultValue: item.defaultTooltip })}
                </p>
              </TooltipContent>
            </Tooltip>
            {index < metricItems.length - 1 && (
              <Separator orientation="vertical" className="h-3 bg-border/50" />
            )}
          </div>
        )
      })}
    </div>
  )
}
