import {
  type AgentRunOutcome,
  type AgentTaskRequirement,
  agentRequirementTier
} from "@ollama-client/contracts"
import type { AgentCompletionOutcomeClaim } from "./completion"

/**
 * How a met requirement was established, in the words the handoff and the
 * user read. Only the runtime's own check says "Verified", and only from an
 * outcome a grading judge wrote: the tier comes from `agentRequirementTier`,
 * the one place that knows an ungraded outcome says nothing about how a
 * requirement was met. A label of its own read the absence of a mark as
 * "Verified", which is the overclaim the tiers exist to stop.
 */
const metLabel = (judged: AgentRunOutcome | undefined, id: string): string => {
  if (!judged?.graded) return "Met, how it was checked is not recorded"
  /**
   * An item the judge met inside a requirement that stayed unmet has no tier
   * of its own for the requirement ("unmet"), and is verified: only a mark on
   * the requirement lowers it.
   */
  switch (agentRequirementTier(judged, id)) {
    case "supported":
      return "Supported by review"
    case "claimed":
      return "Reported, not checked"
    default:
      return "Verified"
  }
}

/** The run record's own ceiling; the summary is cut before anything is added. */
const MAX_RESULT_CHARS = 20_000

/** The most of the agent's own account an unchecked handoff carries. */
const MAX_UNCHECKED_ACCOUNT_CHARS = 1_000

/**
 * A planned run reports checked outcomes and grounded read quotations first.
 * Free-form summaries can overstate partial success, so one is added only
 * when every requirement is met and some only on the agent's word or a
 * picture — never beside an unmet one it could contradict — and labelled.
 * Without it an answer no single quotation states — which of three shops was
 * cheapest, when each price line names only the kettle — reached the chat
 * as a price with no shop, and the user was told the run could not say.
 * Findings remain untrusted page data.
 */
export const agentRunResult = (
  summary: string,
  requirements: readonly AgentTaskRequirement[] | undefined,
  outcomes: readonly AgentCompletionOutcomeClaim[] | undefined,
  met: readonly string[] | undefined,
  judged?: AgentRunOutcome,
  /** The link that opened the page a read quote was read on, if any. */
  pageOf?: (quote: string, requirementId: string) => string | undefined
): string => {
  /** Each quoted part, with the page it came from when a link names it. */
  const sourced = (evidence: string | undefined, id: string) =>
    evidence
      ?.split(/;\s+/)
      .map((part) => {
        const link = pageOf?.(part, id)
        return link ? `${part} (on the page opened from "${link}")` : part
      })
      .join("; ")
  if (!requirements?.length || met === undefined)
    return summary.slice(0, MAX_RESULT_CHARS)
  // Free-form summaries can contradict checked outcomes. The handoff reports
  // only requirements the judge supported, plus their grounded read results.
  const unchecked =
    requirements.every((requirement) => met.includes(requirement.id)) &&
    requirements.some(
      (requirement) =>
        judged?.claimed?.includes(requirement.id) === true ||
        judged?.visual?.includes(requirement.id) === true
    )
  const account = summary.trim().slice(0, MAX_UNCHECKED_ACCOUNT_CHARS)
  const report = requirements
    .map((requirement) => {
      const verified = met.includes(requirement.id)
      const visual = judged?.visual?.includes(requirement.id) === true
      const judgedItems = judged?.items?.find(
        (item) => item.id === requirement.id
      )
      const claim = outcomes?.find((outcome) => outcome.id === requirement.id)
      const items = new Map(
        (claim?.items ?? []).map((item) => [item.index, item])
      )
      const itemReport =
        /** Items the judge supported still show when the whole stayed unmet. */
        requirement.items?.length &&
        (claim?.met || (judgedItems?.met.length ?? 0) > 0)
          ? requirement.items
              .map((item, index) => {
                const answer = items.get(index)
                const supported = judgedItems
                  ? judgedItems.met.includes(index)
                  : verified && answer?.met === true
                const seen =
                  judgedItems?.visual?.includes(index) === true ||
                  (!judgedItems && visual)
                const evidence =
                  supported && requirement.kind === "read"
                    ? sourced(answer?.evidence, requirement.id)
                    : undefined
                return `${supported ? (seen ? "Seen in screenshot" : metLabel(judged, requirement.id)) : "Not verified"} item: ${item}${evidence ? `\n${evidence}` : ""}`
              })
              .join("\n")
          : ""
      const evidence =
        verified && requirement.kind === "read" && !requirement.items?.length
          ? [sourced(claim?.evidence, requirement.id)]
              .filter(Boolean)
              .join("\n")
          : ""
      return `${verified ? (visual ? "Seen in screenshot" : metLabel(judged, requirement.id)) : "Not verified"}: ${requirement.text}${evidence ? `\n${evidence}` : ""}${itemReport ? `\n${itemReport}` : ""}`
    })
    .join("\n")
  return (
    unchecked && account
      ? `${report}\nAgent's own account, not checked: ${account}`
      : report
  ).slice(0, MAX_RESULT_CHARS)
}
