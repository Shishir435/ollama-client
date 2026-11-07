import { MessageSquare, Search } from "lucide-react"
import { useTranslation } from "react-i18next"
import { Button } from "@/components/ui/button"

export const ChatSessionEmpty = ({
  variant = "sessions",
  onCreate
}: {
  variant?: "sessions" | "search"
  onCreate?: () => void
}) => {
  const { t } = useTranslation()
  const isSearch = variant === "search"
  const Icon = isSearch ? Search : MessageSquare

  return (
    <div className="flex h-full flex-col items-center justify-center px-4 py-8 text-center">
      <div className="mb-3 rounded-chip bg-sidebar-accent p-3">
        <Icon className="icon-xl text-muted-foreground" />
      </div>
      <p className="text-sm text-sidebar-foreground">
        {t(
          isSearch
            ? "sessions.selector.no_matches"
            : "sessions.selector.no_sessions"
        )}
      </p>
      {isSearch ? (
        <p className="mt-1 text-xs text-muted-foreground">
          {t("sessions.selector.no_matches_hint")}
        </p>
      ) : (
        onCreate && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="mt-3"
            onClick={onCreate}>
            {t("sessions.selector.create_new")}
          </Button>
        )
      )}
    </div>
  )
}
