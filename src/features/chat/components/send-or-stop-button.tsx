import { SendHorizontal, StopCircle } from "lucide-react"
import { useTranslation } from "react-i18next"
import { TooltipActionButton } from "@/components/actions"
import { useLoadStream } from "@/features/chat/stores/load-stream-store"

export const SendOrStopButton = ({
  onSend,
  stopGeneration,
  disabledSend = false,
  hasContent = false,
  sendLabel
}: {
  onSend: () => void
  stopGeneration: () => void
  disabledSend?: boolean
  /** Whether the composer holds something to send; promotes Send to the primary action. */
  hasContent?: boolean
  sendLabel?: string
}) => {
  const { t } = useTranslation()
  const { isLoading, isStreaming } = useLoadStream()
  const isBusy = isStreaming || isLoading
  const label = isBusy
    ? t("chat.send.stop_generation")
    : sendLabel || t("chat.send.send_message")
  const isPrimary = !isBusy && hasContent && !disabledSend

  return (
    <TooltipActionButton
      onClick={isBusy ? stopGeneration : () => onSend()}
      variant={isPrimary ? "default" : "ghost"}
      size="icon"
      className="rounded-control"
      disabled={!isBusy && disabledSend}
      label={label}
      icon={
        isBusy ? (
          <StopCircle aria-hidden className="icon-sm text-status-danger" />
        ) : (
          <SendHorizontal aria-hidden className="icon-sm" />
        )
      }
    />
  )
}
