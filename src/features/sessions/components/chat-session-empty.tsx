import { MessageSquare } from "lucide-react"
import { useTranslation } from "react-i18next"

export const ChatSessionEmpty = () => {
  const { t } = useTranslation()

  return (
    <div className="flex flex-col items-center justify-center py-8 text-center h-full">
      <div className="mb-3 rounded-full bg-muted/50 p-3">
        <MessageSquare className="h-6 w-6 text-muted-foreground" />
      </div>
      <p className="text-sm text-muted-foreground">
        {t("sessions.selector.no_sessions")}
      </p>
      <p className="mt-1 text-xs text-muted-foreground/70">
        {t("sessions.selector.no_sessions_hint")}
      </p>
    </div>
  )
}
