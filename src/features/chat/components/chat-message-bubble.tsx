import { MarkdownRenderer } from "@/components/markdown-renderer"
import { cn, formatDuration, formatTokensPerSecond } from "@/lib/utils"
import { CopyButton } from "@/features/chat/components/copy-button"
import MetricCard from "@/features/chat/components/metric-card"
import RegenerateButton from "@/features/chat/components/regenerate-button"
import { SpeakButton } from "@/features/chat/components/speak-button"
import type { ChatMessage } from "@/types"

export default function ChatMessageBubble({
  msg,
  onRegenerate,
  isLoading
}: {
  msg: ChatMessage
  onRegenerate?: (model: string) => void
  isLoading?: boolean
}) {
  const isUser = msg.role === "user"

  return (
    <div
      className={cn(
        "group flex w-full flex-col items-start transition-all duration-200",
        isUser && "items-end"
      )}>
      <div
        className={cn(
          "w-full max-w-[90vw] rounded-xl p-3 text-sm shadow-sm sm:max-w-2xl sm:p-4",
          "hover:shadow-md",
          isUser
            ? "bg-gray-200 text-gray-900 dark:bg-gray-700 dark:text-gray-100"
            : "bg-gray-50 text-gray-900 dark:bg-gray-800 dark:text-gray-100",
          "border",
          isUser
            ? "border-gray-300 dark:border-gray-600"
            : "border-gray-200 dark:border-gray-700"
        )}>
        <div className="prose prose-sm prose-gray max-w-none dark:prose-invert">
          <MarkdownRenderer content={msg.content} />
        </div>

        {isLoading && !isUser && (
          <div className="mt-3 flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
            <div className="flex gap-1">
              <div className="h-1 w-1 animate-pulse rounded-full bg-current" />
              <div
                className="h-1 w-1 animate-pulse rounded-full bg-current"
                style={{ animationDelay: "150ms" }}
              />
              <div
                className="h-1 w-1 animate-pulse rounded-full bg-current"
                style={{ animationDelay: "300ms" }}
              />
            </div>
            <span>Thinking...</span>
          </div>
        )}

        {!isUser && msg.done && msg.metrics && (
          <div className="mt-3 border-t border-gray-200 pt-2 dark:border-gray-600">
            <details className="group">
              <summary className="flex cursor-pointer list-none items-center justify-between rounded-md px-2 py-1 text-xs text-gray-500 transition-colors duration-150 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-700">
                <div className="flex items-center gap-2">
                  <span className="font-medium">Performance Metrics</span>
                  {msg.metrics.eval_count && msg.metrics.eval_duration && (
                    <span className="font-mono text-emerald-600 dark:text-emerald-400">
                      {formatTokensPerSecond(
                        msg.metrics.eval_count,
                        msg.metrics.eval_duration
                      )}
                    </span>
                  )}
                </div>
                <svg
                  className="h-4 w-4 transition-transform duration-200 group-open:rotate-180"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24">
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
                  {msg.metrics.total_duration && (
                    <MetricCard
                      title="Total Time"
                      color="blue"
                      value={formatDuration(msg.metrics.total_duration)}
                    />
                  )}
                  {msg.metrics.eval_count && msg.metrics.eval_duration && (
                    <MetricCard
                      title="Generation Speed"
                      color="emerald"
                      value={formatTokensPerSecond(
                        msg.metrics.eval_count,
                        msg.metrics.eval_duration
                      )}
                    />
                  )}
                  {msg.metrics.prompt_eval_count && (
                    <MetricCard
                      title="Prompt Tokens"
                      color="purple"
                      value={msg.metrics.prompt_eval_count.toLocaleString()}
                    />
                  )}
                  {msg.metrics.eval_count && (
                    <MetricCard
                      title="Generated Tokens"
                      color="amber"
                      value={msg.metrics.eval_count.toLocaleString()}
                    />
                  )}
                  {msg.metrics.load_duration && (
                    <MetricCard
                      title="Load Time"
                      color="rose"
                      value={formatDuration(msg.metrics.load_duration)}
                    />
                  )}
                  {msg.metrics.prompt_eval_duration && (
                    <MetricCard
                      title="Prompt Eval Time"
                      color="indigo"
                      value={formatDuration(msg.metrics.prompt_eval_duration)}
                    />
                  )}
                </div>
              </div>
            </details>
          </div>
        )}
      </div>

      <div
        className={cn(
          "mt-1 flex w-full max-w-[85vw] items-center justify-between text-xs text-gray-500 sm:max-w-2xl",
          isUser ? "flex-row-reverse" : "flex-row"
        )}>
        <div className="flex flex-wrap items-center gap-2 pt-1">
          <CopyButton text={msg.content} />
          <SpeakButton text={msg.content} />
          {!isUser && msg.model && !isLoading && (
            <RegenerateButton
              model={msg.model}
              onSelectModel={(model) => onRegenerate?.(model)}
            />
          )}
        </div>

        <div className="pt-1 text-[11px] opacity-70">
          {isUser
            ? new Date().toLocaleTimeString([], {
                hour: "2-digit",
                minute: "2-digit"
              })
            : msg.model || ""}
        </div>
      </div>
    </div>
  )
}
