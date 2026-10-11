import { isTerminalAgentStatus } from "@ollama-client/agent-runtime"
import type { AgentRunStatus } from "@ollama-client/contracts"
import { Hand, Pause, Play, Square, User } from "lucide-react"
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
}

export const AgentRunControls = ({
  status,
  resumeDisabled = false,
  takeoverStarted = false,
  onPause,
  onResume,
  onStop,
  onTakeoverStart = () => undefined,
  onTakeoverComplete
}: AgentRunControlsProps) => {
  const { t } = useTranslation()
  if (isTerminalAgentStatus(status)) return null

  return (
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
        <Button type="button" size="sm" variant="outline" onClick={onPause}>
          <Pause className="icon-xs" aria-hidden="true" />
          {t("agent.controls.pause")}
        </Button>
      )}
      <Button
        type="button"
        size="sm"
        variant="destructive"
        className="ml-auto"
        onClick={onStop}>
        <Square className="icon-xs" aria-hidden="true" />
        {t("agent.controls.stop")}
      </Button>
    </fieldset>
  )
}
