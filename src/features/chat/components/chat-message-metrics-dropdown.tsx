import { useTranslation } from "react-i18next"

import { MetricCard } from "@/features/chat/components/metric-card"
import { formatDuration, formatTokensPerSecond } from "@/lib/utils"
import type { ChatMessage } from "@/types"

export const ChatMessageMetricsDropdown = ({
  metrics
}: {
  metrics: ChatMessage["metrics"]
}) => {
  const { t } = useTranslation()

  return (
    <div className="mt-3 w-full border-t border-gray-200 pt-2 dark:border-gray-600">
      <details className="group">
        <summary className="flex cursor-pointer list-none items-center justify-between rounded-md px-2 py-1 text-xs text-gray-500 transition-colors duration-150 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-700">
          <div className="flex items-center gap-2">
            <span className="font-medium">{t("chat.metrics.title")}</span>
            {metrics.eval_count && metrics.eval_duration && (
              <span className="font-mono text-emerald-600 dark:text-emerald-400">
                {formatTokensPerSecond(
                  metrics.eval_count,
                  metrics.eval_duration
                )}
              </span>
            )}
          </div>
          <svg
            className="h-4 w-4 transition-transform duration-200 group-open:rotate-180"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
            aria-label={t("chat.metrics.toggle_aria_label")}>
            <title>{t("chat.metrics.toggle_title")}</title>
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M19 9l-7 7-7-7"
            />
          </svg>
        </summary>
        <div className="pt-3">
          <div className="grid grid-cols-2 gap-3 text-xs sm:grid-cols-3">
            {metrics.total_duration && (
              <MetricCard
                title={t("chat.metrics.total_time")}
                color="blue"
                value={formatDuration(metrics.total_duration)}
              />
            )}
            {metrics.eval_count && metrics.eval_duration && (
              <MetricCard
                title={t("chat.metrics.generation_speed")}
                color="emerald"
                value={formatTokensPerSecond(
                  metrics.eval_count,
                  metrics.eval_duration
                )}
              />
            )}
            {metrics.prompt_eval_count && (
              <MetricCard
                title={t("chat.metrics.prompt_tokens")}
                color="purple"
                value={metrics.prompt_eval_count.toLocaleString()}
              />
            )}
            {metrics.eval_count && (
              <MetricCard
                title={t("chat.metrics.generated_tokens")}
                color="amber"
                value={metrics.eval_count.toLocaleString()}
              />
            )}
            {metrics.load_duration && (
              <MetricCard
                title={t("chat.metrics.load_time")}
                color="rose"
                value={formatDuration(metrics.load_duration)}
              />
            )}
            {metrics.prompt_eval_duration && (
              <MetricCard
                title={t("chat.metrics.prompt_eval_time")}
                color="indigo"
                value={formatDuration(metrics.prompt_eval_duration)}
              />
            )}
          </div>
        </div>
      </details>
    </div>
  )
}
