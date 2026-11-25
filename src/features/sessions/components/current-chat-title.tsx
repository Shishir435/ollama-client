import { Pencil } from "lucide-react"
import { useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { TooltipActionButton } from "@/components/actions"
import { useChatSessions } from "@/features/sessions/stores/chat-session-store"
import { InlineTitleEditor } from "./inline-title-editor"

/** The open chat's title in the header, renamed in place from its pencil. */
export const CurrentChatTitle = ({
  sessionId,
  title
}: {
  sessionId: string
  title: string
}) => {
  const { t } = useTranslation()
  const { setSessionTitle } = useChatSessions(false)
  /** Keyed to the chat, so switching chats while editing drops the edit. */
  const [editing, setEditing] = useState<string | null>(null)
  const refocus = useRef(false)

  if (editing === sessionId) {
    return (
      <InlineTitleEditor
        value={title}
        ariaLabel={t("sessions.rename.input_label")}
        onSave={(next) => setSessionTitle(sessionId, next)}
        onClose={(focus) => {
          refocus.current = focus
          setEditing((current) => (current === sessionId ? null : current))
        }}
        className="min-w-0 flex-1"
      />
    )
  }

  return (
    <>
      <span
        className="min-w-0 truncate text-xs font-medium text-muted-foreground"
        title={title}>
        {title}
      </span>
      <TooltipActionButton
        type="button"
        variant="ghost"
        size="icon-sm"
        className="size-6 shrink-0 text-muted-foreground"
        label={t("sessions.rename.tooltip")}
        icon={Pencil}
        iconClassName="icon-xs"
        onClick={() => setEditing(sessionId)}
        ref={(button) => {
          if (!button || !refocus.current) return
          refocus.current = false
          button.focus()
        }}
      />
    </>
  )
}
