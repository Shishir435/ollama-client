import { Hand, Pause, Play, Square, User } from "lucide-react"
import { useTranslation } from "react-i18next"
import { Button } from "@/components/ui/button"

export interface AgentRunControlsProps {
  status: string
  inline?: boolean
  resumeDisabled?: boolean
  /**
   * Whether the user already acknowledged the takeover request. Before that
   * the run loop is still parked inside its supervision wait; after it the
   * loop has exited and only Done can resume the run.
   */
  takeoverStarted?: boolean
  onPause: () => void
  onResume: () => void
  onStop: () => void
  onTakeoverStart?: () => void
  onTakeoverComplete: () => void
}

export const AgentRunControls = ({
  status,
  inline = false,
  resumeDisabled = false,
  takeoverStarted = false,
  onPause,
  onResume,
  onStop,
  onTakeoverStart = () => undefined,
  onTakeoverComplete
}: AgentRunControlsProps) => {
  const { t } = useTranslation()
  const terminal = ["completed", "failed", "cancelled"].includes(status)
  if (terminal) return null

  return (
    <fieldset
      className={
        inline
          ? "mt-2 flex flex-wrap gap-1.5"
          : "sticky bottom-0 z-20 flex flex-wrap gap-1.5 border-t border-border bg-surface-chat/95 px-3 py-2 backdrop-blur"
      }>
      <legend className="sr-only">{t("agent.controls.label")}</legend>
      {status === "paused" ? (
        <Button type="button" onClick={onResume} disabled={resumeDisabled}>
          <Play className="icon-xs" aria-hidden="true" />
          {t("agent.controls.resume")}
        </Button>
      ) : status === "awaiting_takeover" ? (
        <>
          {!takeoverStarted && (
            <Button type="button" onClick={onTakeoverStart}>
              <User className="icon-xs" aria-hidden="true" />
              {t("agent.controls.takeover_start")}
            </Button>
          )}
          <Button
            type="button"
            variant={takeoverStarted ? "default" : "outline"}
            onClick={onTakeoverComplete}>
            <Hand className="icon-xs" aria-hidden="true" />
            {t("agent.controls.takeover_done")}
          </Button>
        </>
      ) : (
        <Button type="button" variant="outline" onClick={onPause}>
          <Pause className="icon-xs" aria-hidden="true" />
          {t("agent.controls.pause")}
        </Button>
      )}
      <Button type="button" variant="destructive" onClick={onStop}>
        <Square className="icon-xs" aria-hidden="true" />
        {t("agent.controls.stop")}
      </Button>
    </fieldset>
  )
}
