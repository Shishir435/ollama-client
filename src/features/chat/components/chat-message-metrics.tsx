import { Clock, Cpu, Database, FileText, Loader2, Zap } from "lucide-react"
import { useTranslation } from "react-i18next"

import { MetricCard } from "@/features/chat/components/metric-card"
import { formatDuration, formatTokensPerSecond } from "@/lib/utils"
import type { ChatMessage } from "@/types"

export const ChatMessageMetrics = ({
  metrics
}: {
  metrics: ChatMessage["metrics"]
}) => {
  const { t } = useTranslation()

  if (!metrics) return null

  return (
    <div className="mt-2 flex flex-wrap gap-1 justify-around">
      {metrics.total_duration && (
        <MetricCard
          icon={Clock}
          tooltip={t("chat.metrics.total_time")}
          color="blue"
          value={formatDuration(metrics.total_duration)}
        />
      )}

      {metrics.eval_count && metrics.eval_duration && (
        <MetricCard
          icon={Zap}
          tooltip={t("chat.metrics.generation_speed")}
          color="emerald"
          value={formatTokensPerSecond(
            metrics.eval_count,
            metrics.eval_duration
          )}
        />
      )}

      {metrics.eval_count && (
        <MetricCard
          icon={FileText}
          tooltip={t("chat.metrics.generated_tokens")}
          color="amber"
          value={metrics.eval_count.toLocaleString()}
        />
      )}

      {metrics.prompt_eval_count && (
        <MetricCard
          icon={Database}
          tooltip={t("chat.metrics.prompt_tokens")}
          color="purple"
          value={metrics.prompt_eval_count.toLocaleString()}
        />
      )}

      {metrics.load_duration && (
        <MetricCard
          icon={Loader2}
          tooltip={t("chat.metrics.load_time")}
          color="rose"
          value={formatDuration(metrics.load_duration)}
        />
      )}

      {metrics.prompt_eval_duration && (
        <MetricCard
          icon={Cpu}
          tooltip={t("chat.metrics.prompt_eval_time")}
          color="indigo"
          value={formatDuration(metrics.prompt_eval_duration)}
        />
      )}
    </div>
  )
}
