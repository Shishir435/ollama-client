import { useTranslation } from "react-i18next"
import type { SessionGroupId } from "@/features/sessions/lib/group-chat-sessions"

const LABEL_KEYS: Record<SessionGroupId, string> = {
  pinned: "sessions.groups.pinned",
  today: "sessions.groups.today",
  yesterday: "sessions.groups.yesterday",
  last7Days: "sessions.groups.last7Days",
  older: "sessions.groups.older"
}

export const ChatSessionGroupLabel = ({ id }: { id: SessionGroupId }) => {
  const { t } = useTranslation()

  return (
    <div className="px-2 pb-1 pt-2 text-xs font-medium text-muted-foreground">
      {t(LABEL_KEYS[id])}
    </div>
  )
}
