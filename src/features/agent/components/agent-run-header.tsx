import { Bot, Download, Pause, Play, Square, TriangleAlert } from "lucide-react"
import { useTranslation } from "react-i18next"
import { TooltipActionButton } from "@/components/actions"
import { Button } from "@/components/ui/button"
import type { AgentRun } from "@/lib/repositories/agent-runs"
import { cn } from "@/lib/utils"

export interface AgentRunHeaderProps {
  enabled: boolean
  run: AgentRun | null
  error?: string
  onEnabledChange: (enabled: boolean) => void
  onPause: () => void
  onResume: () => void
  onStop: () => void
  onExport: () => void
}

const elapsed = (milliseconds: number): string => {
  const seconds = Math.max(0, Math.floor(milliseconds / 1_000))
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`
}

const originFrom = (url?: string): string | undefined => {
  if (!url) return undefined
  try {
    return new URL(url).origin
  } catch {
    return undefined
  }
}

export const AgentRunHeader = ({
  enabled,
  run,
  error,
  onEnabledChange,
  onPause,
  onResume,
  onStop,
  onExport
}: AgentRunHeaderProps) => {
  const { t } = useTranslation()
  const active =
    run?.status === "running" ||
    run?.status === "awaiting-approval" ||
    run?.status === "paused"
  const origin = originFrom(run?.state.targetUrl)

  return (
    <section
      className={cn(
        "mb-2 rounded-panel border px-2.5 py-2 text-xs",
        enabled
          ? "border-app-primary/35 bg-app-primary-soft/45"
          : "border-border/50 bg-muted/25"
      )}
      aria-live="polite"
      aria-label={t("agent.header.label")}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="grid size-7 shrink-0 place-items-center rounded-control bg-background shadow-xs">
          <Bot className="icon-sm text-app-primary" aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate font-medium">
            {enabled
              ? t("agent.header.agent_mode")
              : t("agent.header.chat_mode")}
          </div>
          <div className="flex flex-wrap gap-x-2 text-2xs text-muted-foreground">
            {run ? (
              <>
                <span>{t(`agent.status.${run.status}`)}</span>
                {origin && <span className="truncate">{origin}</span>}
                <span>
                  {t("agent.header.steps", {
                    count: run.state.steps.length
                  })}
                </span>
                <span>{elapsed(run.state.activeMs)}</span>
              </>
            ) : (
              <span>
                {enabled
                  ? t("agent.header.ready")
                  : t("agent.header.enable_hint")}
              </span>
            )}
          </div>
        </div>

        {run && (
          <TooltipActionButton
            type="button"
            variant="ghost"
            size="icon-sm"
            labelKey="agent.actions.export"
            icon={Download}
            iconClassName="icon-xs"
            onClick={onExport}
          />
        )}
        {run?.status === "paused" ? (
          <Button type="button" size="sm" onClick={onResume}>
            <Play className="icon-xs" />
            {t("agent.actions.resume")}
          </Button>
        ) : active ? (
          <Button type="button" variant="outline" size="sm" onClick={onPause}>
            <Pause className="icon-xs" />
            {t("agent.actions.pause")}
          </Button>
        ) : (
          <Button
            type="button"
            variant={enabled ? "secondary" : "outline"}
            size="sm"
            aria-pressed={enabled}
            onClick={() => onEnabledChange(!enabled)}>
            {enabled ? t("agent.actions.enabled") : t("agent.actions.enable")}
          </Button>
        )}
        {active && (
          <Button
            type="button"
            variant="destructive"
            size="sm"
            onClick={onStop}>
            <Square className="icon-xs" />
            {t("agent.actions.stop")}
          </Button>
        )}
      </div>

      {(run?.state.injectionWarning || error) && (
        <div
          className="mt-2 flex items-start gap-1.5 rounded-control bg-status-warning/10 px-2 py-1.5 text-status-warning-foreground"
          role="alert">
          <TriangleAlert className="icon-xs mt-0.5 shrink-0" />
          <span>{error ?? run?.state.injectionWarning}</span>
        </div>
      )}
    </section>
  )
}
