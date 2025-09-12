import { Button } from "@/components/ui/button"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger
} from "@/components/ui/tooltip"
import { Trash2 } from "@/lib/lucide-icon"
import { cn } from "@/lib/utils"

interface ChatDeleteButtonProps {
  sessionId: string
  sessionTitle: string
  onDelete: (id: string) => void
}

export const ChatDeleteButton = ({
  sessionId,
  sessionTitle,
  onDelete
}: ChatDeleteButtonProps) => {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className={cn(
            "h-8 w-8 shrink-0 rounded-lg transition-all duration-200",
            "opacity-0 group-hover:opacity-100",
            "hover:bg-destructive/10 hover:text-destructive",
            "focus:bg-destructive/10 focus:text-destructive focus:opacity-100"
          )}
          aria-label={`Delete chat session: ${sessionTitle}`}
          onClick={(e) => {
            e.stopPropagation()
            onDelete(sessionId)
          }}>
          <Trash2 className="h-4 w-4" />
        </Button>
      </TooltipTrigger>
      <TooltipContent>Delete chat</TooltipContent>
    </Tooltip>
  )
}
