import { useTranslation } from "react-i18next"
import { MessageSquare, Search } from "@/lib/lucide-icon"

export const ChatSessionEmpty = ({
  variant = "sessions"
}: {
  variant?: "sessions" | "search"
}) => {
  const { t } = useTranslation()
  const isSearch = variant === "search"
  const Icon = isSearch ? Search : MessageSquare

  return (
    <div className="flex flex-col items-center justify-center py-8 text-center h-full">
      <div className="mb-3 rounded-chip bg-sidebar-accent p-3">
        <Icon className="icon-xl text-sidebar-foreground/70" />
      </div>
      <p className="text-sm text-sidebar-foreground/80">
        {t(
          isSearch
            ? "sessions.selector.no_matches"
            : "sessions.selector.no_sessions"
        )}
      </p>
      <p className="mt-1 text-xs text-sidebar-foreground/60">
        {t(
          isSearch
            ? "sessions.selector.no_matches_hint"
            : "sessions.selector.no_sessions_hint"
        )}
      </p>
    </div>
  )
}
