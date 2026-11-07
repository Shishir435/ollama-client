import { isTerminalAgentStatus } from "@ollama-client/agent-runtime"
import type { AgentRunStatus } from "@ollama-client/contracts"
import { Hand, Loader2, Pause, Play, Square, User } from "lucide-react"
import { useEffect, useRef } from "react"
import { useTranslation } from "react-i18next"
import { Button } from "@/components/ui/button"

export interface AgentRunControlsProps {
  status: AgentRunStatus
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
  /**
   * Message key for a Stop that did not reach the run. It is drawn against the
   * Stop button, because a failure below a long log is a failure the user
   * never sees while the run keeps going.
   */
  stopFailureKey?: string
}

export const AgentRunControls = ({
  status,
  resumeDisabled = false,
  takeoverStarted = false,
  onPause,
  onResume,
  onStop,
  onTakeoverStart = () => undefined,
  onTakeoverComplete,
  stopFailureKey
}: AgentRunControlsProps) => {
  const { t } = useTranslation()
  const failureRef = useRef<HTMLParagraphElement>(null)
  useEffect(() => {
    if (stopFailureKey)
      failureRef.current?.scrollIntoView?.({ block: "nearest" })
  }, [stopFailureKey])
  if (isTerminalAgentStatus(status)) return null
  /** A stop or pause is already in flight: the buttons must not stack more. */
  const stopping = status === "cancelling" || status === "pause_requested"

  return (
    <>
      <fieldset className="mt-2 flex flex-wrap gap-1.5">
        <legend className="sr-only">{t("agent.controls.label")}</legend>
        {status === "paused" ? (
          <Button
            type="button"
            size="sm"
            onClick={onResume}
            disabled={resumeDisabled}>
            <Play className="icon-xs" aria-hidden="true" />
            {t("agent.controls.resume")}
          </Button>
        ) : status === "awaiting_takeover" ? (
          <>
            {!takeoverStarted && (
              <Button type="button" size="sm" onClick={onTakeoverStart}>
                <User className="icon-xs" aria-hidden="true" />
                {t("agent.controls.takeover_start")}
              </Button>
            )}
            <Button
              type="button"
              size="sm"
              variant={takeoverStarted ? "default" : "outline"}
              onClick={onTakeoverComplete}>
              <Hand className="icon-xs" aria-hidden="true" />
              {t("agent.controls.takeover_done")}
            </Button>
          </>
        ) : (
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={stopping}
            onClick={onPause}>
            <Pause className="icon-xs" aria-hidden="true" />
            {t("agent.controls.pause")}
          </Button>
        )}
        <Button
          type="button"
          size="sm"
          variant="destructive"
          className="ml-auto"
          disabled={stopping}
          onClick={onStop}>
          {stopping ? (
            <Loader2 className="icon-xs animate-spin" aria-hidden="true" />
          ) : (
            <Square className="icon-xs" aria-hidden="true" />
          )}
          {t(stopping ? "agent.controls.stopping" : "agent.controls.stop")}
        </Button>
      </fieldset>
      {stopFailureKey && (
        <p
          ref={failureRef}
          role="alert"
          className="mt-1.5 rounded-control border border-destructive/30 bg-tint-danger px-2 py-1 text-xs">
          {t(stopFailureKey)}
        </p>
      )}
    </>
  )
}
