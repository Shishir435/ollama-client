import { MessageSquare } from "lucide-react"
import { useTranslation } from "react-i18next"
import { cn } from "@/lib/utils"
import type { ChatSession } from "@/types"
import { ChatDeleteButton } from "./chat-delete-button"
import { ChatExportButton } from "./chat-export-button"

interface ChatSessionItemProps {
  session: ChatSession
  isActive: boolean
  onClick: (id: string) => void
  onDelete: (id: string) => void
}

export const ChatSessionItem = ({
  session,
  isActive,
  onClick,
  onDelete
}: ChatSessionItemProps) => {
  const { t } = useTranslation()

  return (
    <div className="pb-1">
      <button
        type="button"
        className={cn(
          "group relative flex w-full items-center gap-1 overflow-hidden rounded-lg p-1.5 text-left transition-all duration-200 select-none cursor-pointer outline-hidden focus-visible:ring-2 focus-visible:ring-primary",
          isActive
            ? "bg-primary/15 text-primary shadow-xs ring-1 ring-primary/20"
            : "text-foreground/70 hover:bg-accent/50 hover:text-foreground"
        )}
        onClick={() => onClick(session.id)}
        aria-label={t("sessions.selector.select_session", {
          title: session.title
        })}>
        {isActive && (
          <div className="absolute bottom-0 left-0 top-0 w-1 rounded-r-lg bg-linear-to-b from-primary to-primary/70" />
        )}

        <div className="flex flex-1 min-w-0 items-center gap-3">
          <div
            className={cn(
              "shrink-0 rounded-lg p-1 transition-colors duration-200",
              isActive
                ? "bg-primary/20"
                : "bg-muted/30 group-hover:bg-transparent"
            )}>
            <MessageSquare
              className={cn(
                "h-3.5 w-3.5",
                isActive
                  ? "text-primary"
                  : "text-muted-foreground/70 group-hover:text-foreground"
              )}
            />
          </div>
          <span className="truncate text-sm font-medium leading-none">
            {session.title}
          </span>
        </div>

        <div className="flex shrink-0 items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity duration-200">
          <ChatExportButton sessionId={session.id} />
          <ChatDeleteButton
            sessionId={session.id}
            sessionTitle={session.title}
            onDelete={() => onDelete(session.id)}
          />
        </div>
      </button>
    </div>
  )
}
