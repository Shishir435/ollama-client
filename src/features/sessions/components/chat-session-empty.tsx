import { MessageSquare } from "lucide-react"
import { useTranslation } from "react-i18next"

export const ChatSessionEmpty = () => {
  const { t } = useTranslation()

  return (
    <div className="flex flex-col items-center justify-center py-8 text-center h-full">
      <div className="mb-3 rounded-full bg-sidebar-accent p-3">
        <MessageSquare className="size-6 text-sidebar-foreground/70" />
      </div>
      <p className="text-sm text-sidebar-foreground/80">
        {t("sessions.selector.no_sessions")}
      </p>
      <p className="mt-1 text-xs text-sidebar-foreground/60">
        {t("sessions.selector.no_sessions_hint")}
      </p>
    </div>
  )
}
