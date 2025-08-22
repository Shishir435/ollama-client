import { Circle, SendHorizontal } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger
} from "@/components/ui/tooltip"
import { useLoadStream } from "@/features/chat/hooks/use-load-stream"

export default function SendOrStopButton({
  onSend,
  stopGeneration
}: {
  onSend: () => void
  stopGeneration: () => void
}) {
  const { isLoading, isStreaming } = useLoadStream()
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          onClick={isStreaming || isLoading ? stopGeneration : () => onSend()}
          variant="ghost"
          size="icon"
          className="rounded-full"
          aria-label={
            isStreaming || isLoading ? "Stop generation" : "Send message"
          }>
          {isStreaming || isLoading ? (
            <Circle size={16} className="animate-pulse text-red-500" />
          ) : (
            <SendHorizontal size={16} />
          )}
        </Button>
      </TooltipTrigger>
      <TooltipContent>
        {isStreaming || isLoading ? "Stop generation" : "Send message"}
      </TooltipContent>
    </Tooltip>
  )
}
