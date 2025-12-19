import {
  Clock,
  FileText,
  type LucideIcon,
  MessageSquare,
  Zap
} from "lucide-react"
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

import { cn } from "@/lib/utils"
import type { ChatMessage } from "@/types"

interface MetricItem {
  icon: LucideIcon
  iconColor: string
  value: string
  tooltipKey: string
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

  if (metrics.messageCount === 0) {
    return null
  }

  const metricItems: MetricItem[] = [
    {
      icon: FileText,
      iconColor: "text-amber-600 dark:text-amber-400",
      value: metrics.totalTokens.toLocaleString(),
      tooltipKey: "chat.session_metrics.tooltip_tokens"
    },
    {
      icon: Clock,
      iconColor: "text-blue-600 dark:text-blue-400",
      value: formatSessionDuration(metrics.totalDuration),
      tooltipKey: "chat.session_metrics.tooltip_time"
    },
    {
      icon: Zap,
      iconColor: "text-emerald-600 dark:text-emerald-400",
      value: `${metrics.averageSpeed.toFixed(1)} t/s`,
      tooltipKey: "chat.session_metrics.tooltip_speed"
    },
    {
      icon: MessageSquare,
      iconColor: "text-purple-600 dark:text-purple-400",
      value: String(metrics.messageCount),
      tooltipKey: "chat.session_metrics.tooltip_messages"
    }
  ]

  return (
    <div
      className={cn(
        "mb-2 flex w-full items-center justify-around gap-2 rounded-lg border border-border/40 bg-muted/30 px-3 py-1.5 text-xs text-muted-foreground",
        className
      )}>
      {metricItems.map((item, index) => {
        const Icon = item.icon

        return (
          <div
            key={item.tooltipKey || index}
            className="flex items-center gap-3">
            <Tooltip>
              <TooltipTrigger asChild>
                <div className="flex items-center gap-1.5 cursor-help">
                  <Icon className={cn("size-3", item.iconColor)} />
                  <span className="font-mono">{item.value}</span>
                </div>
              </TooltipTrigger>
              <TooltipContent>
                <p>{t(item.tooltipKey)}</p>
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
