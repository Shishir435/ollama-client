import { MessageSquare } from "lucide-react"
import { useTranslation } from "react-i18next"
import { cn } from "@/lib/utils"
import type { ChatSession } from "@/types"
import { ChatDeleteButton } from "./chat-delete-button"
import { ChatExportButton } from "./chat-export-button"

export interface ChatSessionItemProps {
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
  const updatedTime = new Date(session.updatedAt).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit"
  })

  return (
    <div
      className={cn(
        "group relative mb-0.5 flex w-full items-center overflow-hidden rounded-control transition-all duration-200",
        isActive
          ? "bg-app-primary-soft text-sidebar-accent-foreground ring-1 ring-sidebar-ring/25"
          : "text-sidebar-foreground/72 hover:bg-sidebar-accent/70 hover:text-sidebar-foreground"
      )}>
      {isActive && (
        <div className="absolute bottom-1 left-0 top-1 w-0.5 rounded-chip bg-sidebar-primary" />
      )}
      <button
        type="button"
        className="flex min-w-0 flex-1 items-center gap-1 rounded-control p-1.5 text-left select-none outline-hidden focus-visible:ring-2 focus-visible:ring-primary"
        onClick={() => onClick(session.id)}
        aria-label={t("sessions.selector.select_session", {
          title: session.title
        })}>
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <div
            className={cn(
              "shrink-0 rounded-control p-1 transition-colors duration-200",
              isActive
                ? "bg-sidebar-primary/15"
                : "bg-sidebar-accent/50 group-hover:bg-transparent"
            )}>
            <MessageSquare
              className={cn(
                "size-3",
                isActive
                  ? "text-sidebar-primary"
                  : "text-sidebar-foreground/60 group-hover:text-sidebar-foreground"
              )}
            />
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-[13px] font-medium leading-tight">
              {session.title}
            </div>
            <div className="mt-0.5 truncate text-[10px] text-sidebar-foreground/45">
              {session.modelId || updatedTime}
            </div>
          </div>
        </div>
      </button>
      <div className="flex shrink-0 items-center gap-0.5 pr-1 opacity-0 transition-opacity duration-200 group-hover:opacity-100">
        <ChatExportButton sessionId={session.id} />
        <ChatDeleteButton
          sessionId={session.id}
          sessionTitle={session.title}
          onDelete={() => onDelete(session.id)}
        />
      </div>
    </div>
  )
}
