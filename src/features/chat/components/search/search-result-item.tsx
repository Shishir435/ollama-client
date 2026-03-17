import { useTranslation } from "react-i18next"
import { Badge } from "@/components/ui/badge"
import type { ChatSearchResult } from "@/features/chat/hooks/use-semantic-chat-search"
import { Clock, ExternalLink } from "@/lib/lucide-icon"
import { cn } from "@/lib/utils"

interface SearchResultItemProps {
  result: ChatSearchResult
  onClick: (result: ChatSearchResult) => void
}

export const SearchResultItem = ({
  result,
  onClick
}: SearchResultItemProps) => {
  const { t } = useTranslation()

  const formatTimestamp = (timestamp: number) => {
    try {
      const date = new Date(timestamp)
      const now = Date.now()
      const diffMs = now - timestamp
      const diffMins = Math.floor(diffMs / 60000)
      const diffHours = Math.floor(diffMs / 3600000)
      const diffDays = Math.floor(diffMs / 86400000)

      if (diffMins < 1) return t("chat.search.time_just_now")
      if (diffMins < 60)
        return `${diffMins} ${diffMins === 1 ? t("chat.search.time_minute") : t("chat.search.time_minutes")} ${t("chat.search.time_ago")}`
      if (diffHours < 24)
        return `${diffHours} ${diffHours === 1 ? t("chat.search.time_hour") : t("chat.search.time_hours")} ${t("chat.search.time_ago")}`
      if (diffDays < 7)
        return `${diffDays} ${diffDays === 1 ? t("chat.search.time_day") : t("chat.search.time_days")} ${t("chat.search.time_ago")}`

      return date.toLocaleDateString()
    } catch {
      return t("chat.search.time_unknown")
    }
  }

  const truncateText = (text: string, maxLength: number = 300) => {
    if (text.length <= maxLength) return text
    return `${text.slice(0, maxLength)}...`
  }

  return (
    <button
      type="button"
      className={cn(
        "group relative w-full rounded-lg border border-border bg-card p-3 text-left",
        "hover:bg-accent hover:border-accent-foreground/20 hover:shadow-md",
        "transition-all cursor-pointer shadow-xs active:scale-[0.99]"
      )}
      onClick={() => onClick(result)}>
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-2 min-w-0">
            <Badge
              variant={result.role === "user" ? "default" : "secondary"}
              className="text-[10px] h-5 px-1.5 capitalize shrink-0 font-semibold">
              {result.role === "user"
                ? t("chat.search.role_you")
                : t("chat.search.role_assistant")}
            </Badge>
            <span className="text-[10px] text-muted-foreground flex items-center gap-1 shrink-0 bg-muted/50 px-1.5 py-0.5 rounded-full">
              <Clock className="h-3 w-3" />
              {formatTimestamp(result.timestamp)}
            </span>
          </div>
          <Badge
            variant="outline"
            className="text-[10px] h-5 px-1.5 font-mono shrink-0 bg-background/50 border-primary/20 text-primary">
            {Math.round(result.result.similarity * 100)}%
          </Badge>
        </div>

        <p className="text-sm text-foreground/90 leading-relaxed wrap-break-word line-clamp-4">
          {truncateText(result.messageContent, 300)}
        </p>
      </div>
      <ExternalLink className="h-4 w-4 absolute top-3 right-3 opacity-0 group-hover:opacity-100 transition-all transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5 text-muted-foreground" />
    </button>
  )
}
