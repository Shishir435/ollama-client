import type { AgentApprovalRequest } from "@ollama-client/contracts"
import { ShieldQuestion } from "lucide-react"
import { useEffect, useId, useRef } from "react"
import { useTranslation } from "react-i18next"

import { Button } from "@/components/ui/button"
import { agentDisplayString } from "../lib/display-text"
import {
  AGENT_EVIDENCE_TEXT_LIMIT,
  AGENT_PAGE_TEXT_LIMIT,
  agentPlainText
} from "../lib/presentation"

/** Whether the user is typing somewhere a focus move would interrupt. */
const isEditing = (element: Element | null): boolean =>
  element instanceof HTMLElement &&
  (element.isContentEditable ||
    element.tagName === "TEXTAREA" ||
    (element.tagName === "INPUT" &&
      !["button", "checkbox", "radio", "submit"].includes(
        (element as HTMLInputElement).type
      )))

/**
 * One effect awaiting the user's decision.
 *
 * Widening is offered only when the request carries an origin and the classes
 * policy already decided were grantable. That is deliberate: filling three
 * fields cost three prompts, which trains a user to approve without reading,
 * but whether an effect may be pre-authorized is not a question the panel
 * gets to answer — a critical effect arrives with no offer attached.
 *
 * A run waiting here does nothing until answered, so the request is brought
 * into view and announced when it arrives. Focus moves to the card itself,
 * never to Allow: an Enter meant for something else must not approve an
 * effect. It does not move at all while the user is typing, because taking
 * the caret out of a sentence mid-word is its own kind of harm.
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
  const titleId = useId()
  const ref = useRef<HTMLElement>(null)

  useEffect(() => {
    const card = ref.current
    if (!card || !request.id) return
    card.scrollIntoView?.({ block: "nearest" })
    if (!isEditing(document.activeElement)) card.focus({ preventScroll: true })
  }, [request.id])

  return (
    <section
      ref={ref}
      tabIndex={-1}
      aria-labelledby={titleId}
      className="mb-3 rounded-panel border border-status-warning/40 bg-tint-warning p-2.5 text-xs outline-none focus-visible:ring-2 focus-visible:ring-focus">
      <div role="alert">
        <h2 id={titleId} className="flex items-center gap-1.5 font-medium">
          <ShieldQuestion className="icon-xs shrink-0" aria-hidden="true" />
          {t("agent.approval.title")}
        </h2>
        <p className="mt-1 wrap-break-word font-medium">
          {agentDisplayString(
            t,
            request.display && [request.display.action],
            request.action,
            AGENT_PAGE_TEXT_LIMIT
          )}
        </p>
        <p className="mt-1 wrap-break-word text-muted-foreground">
          {agentDisplayString(
            t,
            request.display?.consequence,
            request.consequence,
            AGENT_PAGE_TEXT_LIMIT
          )}
        </p>
      </div>
      {request.pageEvidence && (
        /**
         * What the user is being asked to approve, so it is shown whole and
         * scrolled rather than cut: a batched fill names every control it
         * sets, and a list clipped at the third one is the disclosure the
         * batch was supposed to keep. Still flattened, still bounded by the
         * request schema's own cap, and still no taller than this box.
         */
        <p className="mt-1 max-h-32 overflow-y-auto wrap-break-word rounded-control bg-surface-sunken px-2 py-1">
          {agentPlainText(request.pageEvidence, AGENT_EVIDENCE_TEXT_LIMIT)}
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
