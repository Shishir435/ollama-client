import type { AgentRunState } from "@ollama-client/contracts"
import { ExternalLink } from "lucide-react"
import { useTranslation } from "react-i18next"

import { Button } from "@/components/ui/button"
import {
  AGENT_PAGE_TEXT_LIMIT,
  agentFailureAdviceKey,
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
    <section className="mt-3 rounded-panel border border-border/50 bg-background p-2.5 text-xs">
      {run.result && (
        <p className="mb-2 whitespace-pre-wrap break-words">
          {agentPlainText(run.result, 20_000)}
        </p>
      )}
      {run.error && (
        <>
          <p className="mb-1 font-medium text-destructive">
            {t(agentFailureAdviceKey(run.error.code))}
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
