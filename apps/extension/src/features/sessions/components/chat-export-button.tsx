import { useState } from "react"
import { useTranslation } from "react-i18next"

import { Button } from "@/components/ui/button"
import {
  Popover,
  PopoverContent,
  PopoverTrigger
} from "@/components/ui/popover"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger
} from "@/components/ui/tooltip"
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
  const [open, setOpen] = useState(false)
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
  const options = showAllSessions
    ? [
        {
          label: t("sessions.export.format_json"),
          icon: FileDown,
          action: () => exportAllSessionsAsJson(sessions)
        },
        {
          label: t("sessions.export.format_pdf"),
          icon: FileText,
          action: () => exportAllSessionsAsPdf(sessions)
        },
        {
          label: t("sessions.export.format_markdown"),
          icon: FileText,
          action: () => exportAllSessionsAsMarkdown(sessions)
        },
        {
          label: t("sessions.export.format_text"),
          icon: FileText,
          action: () => exportAllSessionsAsText(sessions)
        }
      ]
    : current
      ? [
          {
            label: t("sessions.export.format_json"),
            icon: FileDown,
            action: () => exportSessionAsJson(current)
          },
          {
            label: t("sessions.export.format_pdf"),
            icon: FileText,
            action: () => exportSessionAsPdf(current)
          },
          {
            label: t("sessions.export.format_markdown"),
            icon: FileText,
            action: () => exportSessionAsMarkdown(current)
          },
          {
            label: t("sessions.export.format_text"),
            icon: FileText,
            action: () => exportSessionAsText(current)
          }
        ]
      : []

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className={cn(
                "h-8 w-8 shrink-0 rounded-lg transition-all duration-200",
                !showAllSessions && "opacity-0 group-hover:opacity-100",
                "hover:bg-muted hover:text-foreground",
                "focus:bg-muted focus:text-foreground focus:opacity-100"
              )}
              aria-label={
                showAllSessions
                  ? t("sessions.export.aria_label_all")
                  : t("sessions.export.aria_label")
              }>
              <Download className="h-4 w-4" />
            </Button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent side="top">
          {showAllSessions
            ? t("sessions.export.tooltip_all")
            : t("sessions.export.tooltip")}
        </TooltipContent>
      </Tooltip>

      {options.length > 0 && (
        <PopoverContent
          className="w-min p-2"
          align={showAllSessions ? "center" : "end"}>
          <div className="flex flex-col gap-1">
            {options.map(({ label, icon: Icon, action }) => (
              <Button
                key={label}
                variant="ghost"
                size="sm"
                onClick={() => {
                  setOpen(false)
                  action()
                }}
                className="h-8 justify-start px-2 text-sm hover:bg-muted">
                <Icon className="mr-2 h-4 w-4" />
                {label}
              </Button>
            ))}
          </div>
        </PopoverContent>
      )}
    </Popover>
  )
}
