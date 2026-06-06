import { useTranslation } from "react-i18next"

import { TooltipActionButton } from "@/components/actions"
import { Trash2 } from "@/lib/lucide-icon"
import { cn } from "@/lib/utils"

export interface ChatDeleteButtonProps {
  sessionId: string
  sessionTitle: string
  onDelete: (id: string) => void
}

export const ChatDeleteButton = ({
  sessionId,
  sessionTitle,
  onDelete
}: ChatDeleteButtonProps) => {
  const { t } = useTranslation()
  return (
    <TooltipActionButton
      variant="ghost"
      size="icon"
      className={cn(
        "size-7 shrink-0 rounded-control transition-all duration-200",
        "opacity-0 group-hover:opacity-100",
        "hover:bg-destructive/10 hover:text-destructive",
        "focus:bg-destructive/10 focus:text-destructive focus:opacity-100"
      )}
      ariaLabel={t("sessions.delete.aria_label", {
        title: sessionTitle
      })}
      tooltip={t("sessions.delete.tooltip")}
      onClick={(e) => {
        e.stopPropagation()
        onDelete(sessionId)
      }}
      icon={<Trash2 className="size-4" />}
    />
  )
}
