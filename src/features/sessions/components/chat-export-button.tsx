import { useState } from "react"

import { Download, FileDown, FileText } from "lucide-react"

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
import { cn } from "@/lib/utils"
import { useChatExport } from "@/features/sessions/hooks/use-export-chat"
import { useChatSessions } from "@/features/sessions/stores/chat-session-store"

export const ChatExportButton = ({
  showAllSessions = false,
  sessionId
}: {
  showAllSessions?: boolean
  sessionId?: string
}) => {
  const [open, setOpen] = useState(false)
  const { sessions, currentSessionId } = useChatSessions()
  const {
    exportSessionAsPdf,
    exportAllSessionsAsJson,
    exportAllSessionsAsPdf,
    exportSessionAsJson
  } = useChatExport()

  const targetId = sessionId ?? currentSessionId
  const current = sessions.find((s) => s.id === targetId)
  const options = showAllSessions
    ? [
        {
          label: "JSON",
          icon: FileDown,
          action: () => exportAllSessionsAsJson(sessions)
        },
        {
          label: "PDF",
          icon: FileText,
          action: () => exportAllSessionsAsPdf(sessions)
        }
      ]
    : current
      ? [
          {
            label: "JSON",
            icon: FileDown,
            action: () => exportSessionAsJson(current)
          },
          {
            label: "PDF",
            icon: FileText,
            action: () => exportSessionAsPdf(current)
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
                showAllSessions ? "Export all chat sessions" : "Export chat"
              }>
              <Download className="h-4 w-4" />
            </Button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent side="top">
          {showAllSessions ? "Export all chat sessions" : "Export chat"}
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
