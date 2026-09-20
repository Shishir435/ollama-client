import type { AgentRunState } from "@ollama-client/contracts"
import { Check, ExternalLink, Minus } from "lucide-react"
import { useTranslation } from "react-i18next"

import { Button } from "@/components/ui/button"
import {
  AGENT_PAGE_TEXT_LIMIT,
  agentFailureMessageKey,
  agentPlainText
} from "../lib/presentation"

/**
 * How a settled run reads afterwards.
 *
 * A failure used to show the runtime's own sentence, which is written in
 * English for whoever reads a receipt and says what happened rather than what
 * to do about it. The advice comes first now, in the reader's language, keyed
 * off the failure's code; the original stays underneath, because a person
 * reporting the problem still needs the words the run used.
 */
export const AgentOutcomeCard = ({
  run,
  providerName,
  onFeedback
}: {
  run: AgentRunState
  providerName: string
  onFeedback: () => void
}) => {
  const { t } = useTranslation()

  return (
    <section className="mt-3 rounded-panel border border-border bg-background p-2.5 text-xs">
      {run.result && (
        <p className="mb-2 whitespace-pre-wrap wrap-break-word">
          {agentPlainText(run.result, 20_000)}
        </p>
      )}
      {run.requirements && run.requirements.length > 0 && (
        <>
          <p className="mb-1 font-medium">{t("agent.requirements.title")}</p>
          <ul className="mb-2 flex flex-col gap-1">
            {run.requirements.map((requirement) => {
              const met = run.outcome?.met.includes(requirement.id) === true
              return (
                <li key={requirement.id} className="flex items-start gap-1.5">
                  {met ? (
                    <Check
                      className="icon-xs mt-0.5 shrink-0"
                      aria-hidden="true"
                    />
                  ) : (
                    <Minus
                      className="icon-xs mt-0.5 shrink-0 text-muted-foreground"
                      aria-hidden="true"
                    />
                  )}
                  <span className={met ? undefined : "text-muted-foreground"}>
                    <span className="sr-only">
                      {t(
                        met
                          ? "agent.requirements.met"
                          : "agent.requirements.unmet"
                      )}
                    </span>{" "}
                    {agentPlainText(requirement.text, 200)}
                  </span>
                </li>
              )
            })}
          </ul>
        </>
      )}
      {run.error && (
        <>
          <p className="mb-1 font-medium text-destructive">
            {t(agentFailureMessageKey(run.error))}
          </p>
          <p className="mb-1 text-muted-foreground">
            {agentPlainText(run.error.message, AGENT_PAGE_TEXT_LIMIT)}
          </p>
        </>
      )}
      <p>
        {t("agent.completion.summary", {
          count: run.observationCount,
          provider: agentPlainText(providerName, 100)
        })}
      </p>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="mt-2"
        onClick={onFeedback}>
        <ExternalLink className="icon-xs" aria-hidden="true" />
        {t("agent.feedback")}
      </Button>
    </section>
  )
}
