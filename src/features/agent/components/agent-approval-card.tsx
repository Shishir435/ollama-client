import type { AgentApprovalRequest } from "@ollama-client/contracts"
import { useTranslation } from "react-i18next"

import { Button } from "@/components/ui/button"
import { AGENT_PAGE_TEXT_LIMIT, agentPlainText } from "../lib/presentation"

/**
 * One effect awaiting the user's decision.
 *
 * Widening is offered only when the request carries an origin and the classes
 * policy already decided were grantable. That is deliberate: filling three
 * fields cost three prompts, which trains a user to approve without reading,
 * but whether an effect may be pre-authorized is not a question the panel
 * gets to answer — a critical effect arrives with no offer attached.
 */
export const AgentApprovalCard = ({
  request,
  onApprove,
  onReject
}: {
  request: AgentApprovalRequest
  onApprove: (scope?: "run_origin") => void
  onReject: () => void
}) => {
  const { t } = useTranslation()
  const grantable = Boolean(request.origin && request.grantable?.length)

  return (
    <section className="mb-3 rounded-panel border border-status-warning/40 bg-status-warning/10 p-2.5 text-xs">
      <h2 className="font-medium">{t("agent.approval.title")}</h2>
      <p className="mt-1 break-words">
        {agentPlainText(request.action, AGENT_PAGE_TEXT_LIMIT)}
      </p>
      <p className="mt-1 break-words text-muted-foreground">
        {agentPlainText(request.consequence, AGENT_PAGE_TEXT_LIMIT)}
      </p>
      {request.pageEvidence && (
        <p className="mt-1 max-h-12 overflow-hidden break-words rounded-control bg-background/70 px-2 py-1">
          {agentPlainText(request.pageEvidence, AGENT_PAGE_TEXT_LIMIT)}
        </p>
      )}
      <div className="mt-2 flex gap-1.5">
        <Button onClick={() => onApprove()} type="button">
          {t("agent.approval.allow")}
        </Button>
        <Button onClick={onReject} type="button" variant="outline">
          {t("agent.approval.reject")}
        </Button>
      </div>
      {grantable && (
        <Button
          className="mt-1.5 h-auto justify-start whitespace-normal px-0 text-left text-xs"
          onClick={() => onApprove("run_origin")}
          type="button"
          variant="ghost">
          {t("agent.approval.allowForRun", { origin: request.origin })}
        </Button>
      )}
    </section>
  )
}
