import { CircleAlert, Info, TriangleAlert } from "lucide-react"
import { useTranslation } from "react-i18next"
import { cn } from "@/lib/class-names"
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
 */
export const AgentReadinessLine = ({
  state
}: {
  state: AgentReadinessState
}) => {
  const { t } = useTranslation()
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

  return (
    <p
      role={tone === "muted" ? "status" : "alert"}
      data-testid="agent-readiness-line"
      className={cn(
        "flex items-start gap-1.5 px-1 pb-1.5 text-micro",
        tone === "danger" && "text-status-danger",
        tone === "warning" && "text-status-warning",
        tone === "muted" && "text-muted-foreground"
      )}>
      <Icon className="icon-xs mt-px shrink-0" aria-hidden="true" />
      <span className="min-w-0">
        {t(`agent.readiness.${key}.title`)}{" "}
        <span className="text-muted-foreground">
          {t(`agent.readiness.${key}.fix`)}
          {alternatives.length > 0 &&
            ` ${t("agent.readiness.alternatives", {
              models: alternatives.join(", ")
            })}`}
        </span>
      </span>
    </p>
  )
}

/** The line, fed by the selected model's readiness. */
export const SelectedModelAgentReadiness = () => (
  <AgentReadinessLine state={useAgentReadiness()} />
)
