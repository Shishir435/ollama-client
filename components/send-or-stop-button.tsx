import { Button } from "@/components/ui/button"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger
} from "@/components/ui/tooltip"
import { Circle, SendHorizontal } from "lucide-react"

export default function SendOrStopButton({
  isLoading,
  isStreaming,
  onSend,
  stopGeneration
}: {
  isLoading: boolean
  isStreaming: boolean
  onSend: () => void
  stopGeneration: () => void
}) {
  const showStop = isStreaming

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          onClick={showStop ? stopGeneration : onSend}
          variant="ghost"
          size="icon"
          className="absolute bottom-1 right-0 mr-2 rounded-full"
          aria-label={showStop ? "Stop generation" : "Send message"}
          disabled={isLoading && !isStreaming}>
          {showStop ? (
            <Circle size={16} className="animate-pulse text-red-500" />
          ) : (
            <SendHorizontal size={16} />
          )}
        </Button>
      </TooltipTrigger>
      <TooltipContent>
        {showStop ? "Stop generation" : "Send message"}
      </TooltipContent>
    </Tooltip>
  )
}
