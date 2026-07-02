import { useTranslation } from "react-i18next"
import type { SessionGroupId } from "@/features/sessions/lib/group-chat-sessions"

const LABEL_KEYS: Record<SessionGroupId, string> = {
  pinned: "sessions.groups.pinned",
  today: "sessions.groups.today",
  yesterday: "sessions.groups.yesterday",
  last7Days: "sessions.groups.last7Days",
  older: "sessions.groups.older"
}

const FALLBACK_LABELS: Record<SessionGroupId, string> = {
  pinned: "Pinned",
  today: "Today",
  yesterday: "Yesterday",
  last7Days: "Last 7 days",
  older: "Older"
}

export const ChatSessionGroupLabel = ({ id }: { id: SessionGroupId }) => {
  const { t } = useTranslation()

  return (
    <div className="px-2 pb-1 pt-2 text-micro font-semibold uppercase tracking-[0.12em] text-sidebar-foreground/45">
      {t(LABEL_KEYS[id], FALLBACK_LABELS[id])}
    </div>
  )
}
