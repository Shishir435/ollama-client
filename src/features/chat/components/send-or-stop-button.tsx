import { useTranslation } from "react-i18next"

import { TooltipActionButton } from "@/components/actions"
import { useLoadStream } from "@/features/chat/stores/load-stream-store"
import { SendHorizontal, StopCircle } from "@/lib/lucide-icon"

export const SendOrStopButton = ({
  onSend,
  stopGeneration,
  disabledSend = false,
  sendLabel
}: {
  onSend: () => void
  stopGeneration: () => void
  disabledSend?: boolean
  sendLabel?: string
}) => {
  const { t } = useTranslation()
  const { isLoading, isStreaming } = useLoadStream()
  const label =
    isStreaming || isLoading
      ? t("chat.send.stop_generation")
      : sendLabel || t("chat.send.send_message")

  return (
    <TooltipActionButton
      onClick={isStreaming || isLoading ? stopGeneration : () => onSend()}
      variant="ghost"
      size="icon"
      className="rounded-control"
      disabled={!isStreaming && !isLoading && disabledSend}
      label={label}
      icon={
        isStreaming || isLoading ? (
          <StopCircle size={16} className="text-status-danger" />
        ) : (
          <SendHorizontal size={16} />
        )
      }
    />
  )
}
