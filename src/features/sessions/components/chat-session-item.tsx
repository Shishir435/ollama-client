import { MessageSquare } from "lucide-react"
import { useTranslation } from "react-i18next"
import { useChatExport } from "@/features/sessions/hooks/use-export-chat"
import { useChatSessions } from "@/features/sessions/stores/chat-session-store"
import {
  Code,
  FileDown,
  FileText,
  MoreHorizontal,
  Trash2
} from "@/lib/lucide-icon"
import { cn } from "@/lib/utils"
import type { ChatSession } from "@/types"
import { ChatSessionActions } from "./chat-session-actions"

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
  const { sessions } = useChatSessions()
  const {
    exportSessionAsPdf,
    exportSessionAsJson,
    exportSessionAsMarkdown,
    exportSessionAsText
  } = useChatExport()

  const current = sessions.find((s) => s.id === session.id)
  const updatedTime = new Date(session.updatedAt).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit"
  })

  const actionItems = current
    ? [
        {
          key: "json",
          label: t("sessions.export.format_json"),
          icon: <FileDown className="icon-md" />,
          onClick: () => exportSessionAsJson(current)
        },
        {
          key: "pdf",
          label: t("sessions.export.format_pdf"),
          icon: <FileDown className="icon-md" />,
          onClick: () => exportSessionAsPdf(current)
        },
        {
          key: "markdown",
          label: t("sessions.export.format_markdown"),
          icon: <Code className="icon-md" />,
          onClick: () => exportSessionAsMarkdown(current)
        },
        {
          key: "text",
          label: t("sessions.export.format_text"),
          icon: <FileText className="icon-md" />,
          onClick: () => exportSessionAsText(current)
        },
        {
          key: "delete",
          label: t("sessions.delete.tooltip"),
          tooltip: t("sessions.delete.tooltip"),
          ariaLabel: t("sessions.delete.aria_label", { title: session.title }),
          icon: <Trash2 className="icon-md" />,
          destructive: true,
          onClick: () => onDelete(session.id)
        }
      ]
    : []

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
                "icon-xs",
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
        <ChatSessionActions
          actions={actionItems}
          trigger={{
            ariaLabel: t("sessions.actions.more", { title: session.title }),
            tooltip: t("sessions.actions.tooltip"),
            icon: <MoreHorizontal className="icon-md" />
          }}
        />
      </div>
    </div>
  )
}
