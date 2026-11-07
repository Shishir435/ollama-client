import { ChevronDown, CircleAlert, Info, TriangleAlert } from "lucide-react"
import { useId, useState } from "react"
import { useTranslation } from "react-i18next"
import { useSetting } from "@/hooks/use-setting"
import { cn } from "@/lib/class-names"
import { SETTINGS } from "@/lib/storage/settings"
import {
  type AgentReadinessState,
  useAgentReadiness
} from "../hooks/use-agent-readiness"

/**
 * One line above the composer saying whether the selected model can drive
 * the browser agent, and how to fix it when it cannot. Shown before a task is
 * sent, so a model the start would refuse is named here rather than in a
 * refusal the chat model may keep retrying. Nothing is shown for a model
 * that is ready and qualified, or while the agent is off.
 *
 * It holds one line until asked for more: the verdict stays readable at a
 * glance, and the explanation opens in place rather than taking three lines
 * of the composer on every turn. The full text stays in the live region, so
 * a screen reader hears all of it either way.
 */
export const AgentReadinessLine = ({
  state
}: {
  state: AgentReadinessState
}) => {
  const { t } = useTranslation()
  const [expanded, setExpanded] = useState(false)
  const textId = useId()
  if (state.kind !== "known") return null
  const { readiness, qualified } = state
  if (readiness.status === "ready" && qualified) return null

  const tone =
    readiness.status === "unsupported"
      ? "danger"
      : readiness.status === "experimental"
        ? "warning"
        : "muted"
  const Icon =
    tone === "danger" ? CircleAlert : tone === "warning" ? TriangleAlert : Info
  const key = readiness.status === "ready" ? "not_qualified" : readiness.status
  const alternatives = readiness.alternatives ?? []
  const detailsLabel = t(
    expanded ? "agent.readiness.hide_details" : "agent.readiness.show_details"
  )

  return (
    /**
     * Guidance, not an emergency: it arrives after the model is picked, and an
     * assertive alert would cut into whatever the screen reader was saying.
     */
    <output
      aria-live="polite"
      data-testid="agent-readiness-line"
      className={cn(
        "flex items-start gap-1 px-1 pb-1.5 text-micro",
        tone === "danger" && "text-status-danger-text",
        tone === "warning" && "text-status-warning-text",
        tone === "muted" && "text-muted-foreground"
      )}>
      <Icon className="icon-xs mt-px shrink-0" aria-hidden="true" />
      <span
        id={textId}
        className={cn("min-w-0 flex-1", !expanded && "truncate")}>
        {t(`agent.readiness.${key}.title`)}{" "}
        <span className="text-muted-foreground">
          {t(`agent.readiness.${key}.fix`)}
          {alternatives.length > 0 &&
            ` ${t("agent.readiness.alternatives", {
              models: alternatives.join(", ")
            })}`}
        </span>
      </span>
      <button
        type="button"
        aria-expanded={expanded}
        aria-controls={textId}
        aria-label={detailsLabel}
        title={detailsLabel}
        onClick={() => setExpanded((current) => !current)}
        className="-my-0.5 shrink-0 rounded-control p-0.5 text-muted-foreground hover:bg-state-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <ChevronDown
          aria-hidden="true"
          className={cn(
            "icon-xs transition-transform",
            expanded && "rotate-180"
          )}
        />
      </button>
    </output>
  )
}

/** The line, fed by the selected model's readiness. */
export const SelectedModelAgentReadiness = () => {
  const state = useAgentReadiness()
  const [selected] = useSetting(SETTINGS.SELECTED_MODEL_REF)
  /** Keyed by model so one model's expanded notice never carries to the next. */
  return (
    <AgentReadinessLine
      key={`${selected?.providerId}:${selected?.modelId}`}
      state={state}
    />
  )
}
