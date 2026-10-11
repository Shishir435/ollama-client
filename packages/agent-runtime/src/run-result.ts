import type {
  AgentRunOutcome,
  AgentTaskRequirement
} from "@ollama-client/contracts"

import type { AgentCompletionOutcomeClaim } from "./completion"

/** The run record's own ceiling; the summary is cut before anything is added. */
const MAX_RESULT_CHARS = 20_000

/**
 * A planned run reports only checked outcomes and grounded read quotations.
 * Free-form summaries can overstate partial success, so they remain on the
 * legacy unplanned path only. Findings remain untrusted page data.
 */
export const agentRunResult = (
  summary: string,
  requirements: readonly AgentTaskRequirement[] | undefined,
  outcomes: readonly AgentCompletionOutcomeClaim[] | undefined,
  met: readonly string[] | undefined,
  judged?: AgentRunOutcome
): string => {
  if (!requirements?.length || met === undefined)
    return summary.slice(0, MAX_RESULT_CHARS)
  // Free-form summaries can contradict checked outcomes. The handoff reports
  // only requirements the judge supported, plus their grounded read results.
  return requirements
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
                    ? answer?.evidence
                    : undefined
                return `${supported ? (seen ? "Seen in screenshot" : "Verified") : "Not verified"} item: ${item}${evidence ? `\n${evidence}` : ""}`
              })
              .join("\n")
          : ""
      const evidence =
        verified && requirement.kind === "read" && !requirement.items?.length
          ? [claim?.evidence].filter(Boolean).join("\n")
          : ""
      return `${verified ? (visual ? "Seen in screenshot" : "Verified") : "Not verified"}: ${requirement.text}${evidence ? `\n${evidence}` : ""}${itemReport ? `\n${itemReport}` : ""}`
    })
    .join("\n")
    .slice(0, MAX_RESULT_CHARS)
}
