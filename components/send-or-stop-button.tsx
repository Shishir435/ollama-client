import { Button } from "@/components/ui/button"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger
} from "@/components/ui/tooltip"
import { Circle, SendHorizontal } from "lucide-react"

export default function SendOrStopButton({
  isLoading,
  onSend,
  stopGeneration
}: {
  isLoading: boolean
  onSend: () => void
  stopGeneration: () => void
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          onClick={isLoading ? stopGeneration : onSend}
          variant="ghost"
          size="icon"
          className="absolute bottom-1 right-0 mr-2 rounded-full"
          aria-label={isLoading ? "Stop generation" : "Send message"}>
          {isLoading ? (
            <Circle size={16} className="animate-pulse" />
          ) : (
            <SendHorizontal size={16} />
          )}
        </Button>
      </TooltipTrigger>
      <TooltipContent>
        {isLoading ? "Stop generation" : "Send message"}
      </TooltipContent>
    </Tooltip>
  )
}
