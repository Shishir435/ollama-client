import { Loader2, SendHorizontal, Square } from "lucide-react"
import { useTranslation } from "react-i18next"
import { TooltipActionButton } from "@/components/actions"
import { Button } from "@/components/ui/button"
import { useLoadStream } from "@/features/chat/stores/load-stream-store"
import { useShortcutStore } from "@/stores/shortcut-store"

/** "Escape" reads as "Esc"; every other key prints as stored. */
const formatShortcutKey = (key: string) =>
  key
    .split("+")
    .map((part) => (part === "Escape" ? "Esc" : part))
    .join("+")

export const SendOrStopButton = ({
  onSend,
  stopGeneration,
  disabledSend = false,
  hasContent = false,
  sendLabel
}: {
  onSend: () => void
  stopGeneration: () => void
  /** True while the composer cannot send yet (tab text still being read). */
  disabledSend?: boolean
  /** Whether the composer holds something to send; promotes Send to the primary action. */
  hasContent?: boolean
  sendLabel?: string
}) => {
  const { t } = useTranslation()
  const { isLoading, isStreaming } = useLoadStream()
  const stopKey = useShortcutStore((state) => state.shortcuts.stopGeneration)
  const isBusy = isStreaming || isLoading

  if (isBusy) {
    const hint = stopKey?.key ? formatShortcutKey(stopKey.key) : ""
    return (
      <div className="flex items-center gap-2">
        {hint && (
          <span className="text-2xs text-muted-foreground">
            {t("chat.send.stop_hint", { key: hint })}
          </span>
        )}
        <Button
          type="button"
          size="sm"
          className="gap-1.5 rounded-control bg-destructive text-destructive-foreground hover:bg-status-danger-hover"
          onClick={stopGeneration}
          aria-label={t("chat.send.stop_generation")}
          title={t("chat.send.stop_generation")}>
          <Square aria-hidden className="icon-xs fill-current" />
          {t("chat.send.stop")}
        </Button>
      </div>
    )
  }

  const label = sendLabel || t("chat.send.send_message")
  const isPrimary = hasContent && !disabledSend

  return (
    <TooltipActionButton
      onClick={() => onSend()}
      variant={isPrimary ? "default" : "ghost"}
      size="icon"
      className={
        isPrimary ? "rounded-control" : "rounded-control text-muted-foreground"
      }
      disabled={disabledSend}
      label={label}
      icon={
        disabledSend ? (
          <Loader2 aria-hidden className="icon-sm animate-spin" />
        ) : (
          <SendHorizontal aria-hidden className="icon-sm" />
        )
      }
    />
  )
}
