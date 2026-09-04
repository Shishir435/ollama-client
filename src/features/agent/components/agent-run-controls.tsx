import { Hand, Pause, Play, Square } from "lucide-react"
import { useTranslation } from "react-i18next"
import { Button } from "@/components/ui/button"

export interface AgentRunControlsProps {
  status: string
  onPause: () => void
  onResume: () => void
  onStop: () => void
  onTakeoverComplete: () => void
}

export const AgentRunControls = ({
  status,
  onPause,
  onResume,
  onStop,
  onTakeoverComplete
}: AgentRunControlsProps) => {
  const { t } = useTranslation()
  const terminal = ["completed", "failed", "cancelled"].includes(status)
  if (terminal) return null

  return (
    <fieldset className="sticky bottom-0 z-20 flex flex-wrap gap-1.5 border-t border-border/50 bg-surface-chat/95 px-3 py-2 backdrop-blur">
      <legend className="sr-only">{t("agent.controls.label")}</legend>
      {status === "paused" ? (
        <Button type="button" onClick={onResume}>
          <Play className="icon-xs" aria-hidden="true" />
          {t("agent.controls.resume")}
        </Button>
      ) : status === "awaiting_takeover" ? (
        <Button type="button" onClick={onTakeoverComplete}>
          <Hand className="icon-xs" aria-hidden="true" />
          {t("agent.controls.takeover_done")}
        </Button>
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
