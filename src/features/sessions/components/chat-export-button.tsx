import { useTranslation } from "react-i18next"

import {
  ActionMenuGrid,
  type ActionMenuItemConfig,
  TooltipActionButton
} from "@/components/actions"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuTrigger
} from "@/components/ui/dropdown-menu"
import { useChatExport } from "@/features/sessions/hooks/use-export-chat"
import { useChatSessions } from "@/features/sessions/stores/chat-session-store"
import { Download, FileDown, FileText } from "@/lib/lucide-icon"
import { cn } from "@/lib/utils"

export const ChatExportButton = ({
  showAllSessions = false,
  sessionId
}: {
  showAllSessions?: boolean
  sessionId?: string
}) => {
  const { t } = useTranslation()
  const { sessions, currentSessionId } = useChatSessions()
  const {
    exportSessionAsPdf,
    exportAllSessionsAsJson,
    exportAllSessionsAsPdf,
    exportSessionAsJson,
    exportSessionAsMarkdown,
    exportAllSessionsAsMarkdown,
    exportSessionAsText,
    exportAllSessionsAsText
  } = useChatExport()

  const targetId = sessionId ?? currentSessionId
  const current = sessions.find((s) => s.id === targetId)

  const actionItems: ActionMenuItemConfig[] = showAllSessions
    ? [
        {
          key: "json",
          label: t("sessions.export.format_json"),
          icon: <FileDown className="icon-md" />,
          onClick: () => exportAllSessionsAsJson(sessions)
        },
        {
          key: "pdf",
          label: t("sessions.export.format_pdf"),
          icon: <FileText className="icon-md" />,
          onClick: () => exportAllSessionsAsPdf(sessions)
        },
        {
          key: "markdown",
          label: t("sessions.export.format_markdown"),
          icon: <FileText className="icon-md" />,
          onClick: () => exportAllSessionsAsMarkdown(sessions)
        },
        {
          key: "text",
          label: t("sessions.export.format_text"),
          icon: <FileText className="icon-md" />,
          onClick: () => exportAllSessionsAsText(sessions)
        }
      ]
    : current
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
            icon: <FileText className="icon-md" />,
            onClick: () => exportSessionAsPdf(current)
          },
          {
            key: "markdown",
            label: t("sessions.export.format_markdown"),
            icon: <FileText className="icon-md" />,
            onClick: () => exportSessionAsMarkdown(current)
          },
          {
            key: "text",
            label: t("sessions.export.format_text"),
            icon: <FileText className="icon-md" />,
            onClick: () => exportSessionAsText(current)
          }
        ]
      : []

  if (actionItems.length === 0) return null

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <TooltipActionButton
            variant="ghost"
            size="icon"
            className={cn(
              "size-7 shrink-0 rounded-control transition-all duration-200",
              !showAllSessions && "opacity-0 group-hover:opacity-100",
              "hover:bg-muted hover:text-foreground",
              "focus:bg-muted focus:text-foreground focus:opacity-100"
            )}
            ariaLabel={
              showAllSessions
                ? t("sessions.export.aria_label_all")
                : t("sessions.export.aria_label")
            }
            tooltip={
              showAllSessions
                ? t("sessions.export.tooltip_all")
                : t("sessions.export.tooltip")
            }
            icon={<Download className="icon-md" />}
          />
        }>
        <DropdownMenuContent
          align={showAllSessions ? "center" : "end"}
          sideOffset={6}
          className="w-auto rounded-panel border-muted/60 p-0.5 shadow-md data-open:animate-none data-closed:animate-none">
          <DropdownMenuGroup>
            <ActionMenuGrid actions={actionItems} />
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenuTrigger>
    </DropdownMenu>
  )
}
