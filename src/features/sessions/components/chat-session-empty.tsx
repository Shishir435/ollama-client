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
