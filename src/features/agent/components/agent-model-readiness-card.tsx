import type { AgentModelReadiness } from "@ollama-client/contracts"
import { useTranslation } from "react-i18next"

import { cn } from "@/lib/class-names"

/**
 * What the selected model can do, before a goal is written for it.
 *
 * The panel used to say nothing here: Start was live for every model, and a
 * model that cannot call tools was refused at planning time, after the run had
 * attached to a tab. The three states this shows are the three the run itself
 * decides by, so the label and the refusal cannot disagree.
 *
 * Vision is a second line rather than a second verdict. A text-only model runs
 * — it reads the page and its controls — so saying so is a limit worth knowing
 * while a task is being chosen, not a reason to refuse one.
 */
export const AgentModelReadinessCard = ({
  readiness,
  allowExperimental,
  onAllowExperimental
}: {
  readiness: AgentModelReadiness
  allowExperimental: boolean
  onAllowExperimental: (allowed: boolean) => void
}) => {
  const { t } = useTranslation()
  const blocked = readiness.status === "unsupported"

  return (
    <section
      className={cn(
        "mb-3 rounded-panel border p-2.5 text-xs",
        blocked
          ? "border-status-warning/40 bg-tint-warning"
          : "border-border bg-surface-sunken"
      )}>
      <div className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5">
        <h2 className="font-medium">
          {t(`agent.readiness.status.${readiness.status}`)}
        </h2>
        {/* A separate span, never a joined string: the two states are
            translated apart and one of them can be absent. */}
        {!blocked && (
          <span className="text-muted-foreground">
            {t(`agent.readiness.vision.${readiness.vision}`)}
          </span>
        )}
      </div>
      <p className="mt-1 text-muted-foreground">
        {t(`agent.readiness.reason.${readiness.reason}`)}
      </p>
      {!blocked && readiness.vision === "unsupported" && (
        <p className="mt-1 text-muted-foreground">
          {t("agent.readiness.text_only")}
        </p>
      )}
      {blocked && readiness.alternatives && (
        <div className="mt-1.5">
          <p className="text-muted-foreground">
            {t("agent.readiness.alternatives")}
          </p>
          <ul className="mt-0.5 list-disc pl-4 font-mono text-micro">
            {readiness.alternatives.map((model) => (
              <li key={model}>{model}</li>
            ))}
          </ul>
        </div>
      )}
      {/*
        Offered only where the user's own override is what turned tool calling
        on. Nothing here can enable a model the provider reports as unable to
        call tools — an override is evidence the user supplied, and this is
        where they confirm they meant to run on it.
      */}
      {readiness.status === "experimental" && (
        <label className="mt-2 flex items-start gap-2">
          <input
            type="checkbox"
            className="mt-0.5"
            checked={allowExperimental}
            onChange={(event) => onAllowExperimental(event.target.checked)}
          />
          <span>
            <span className="font-medium">
              {t("agent.readiness.allow_experimental")}
            </span>
            <span className="mt-1 block text-muted-foreground">
              {t("agent.readiness.allow_experimental_description")}
            </span>
          </span>
        </label>
      )}
    </section>
  )
}
