import type { AgentTaskRequirement } from "@ollama-client/contracts"

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
  met: readonly string[] | undefined
): string => {
  if (!requirements?.length || met === undefined)
    return summary.slice(0, MAX_RESULT_CHARS)
  // Free-form summaries can contradict checked outcomes. The handoff reports
  // only requirements the judge supported, plus their grounded read results.
  return requirements
    .map((requirement) => {
      const verified = met.includes(requirement.id)
      const claim = outcomes?.find((outcome) => outcome.id === requirement.id)
      const items = new Map(
        (claim?.items ?? []).map((item) => [item.index, item])
      )
      const itemReport =
        requirement.items?.length && claim?.met
          ? requirement.items
              .map((item, index) => {
                const answer = items.get(index)
                const evidence =
                  answer?.met && requirement.kind === "read"
                    ? answer.evidence
                    : undefined
                return `${answer?.met ? "Verified" : "Not verified"} item: ${item}${evidence ? `\n${evidence}` : ""}`
              })
              .join("\n")
          : ""
      const evidence =
        verified && requirement.kind === "read"
          ? [claim?.evidence].filter(Boolean).join("\n")
          : ""
      return `${verified ? "Verified" : "Not verified"}: ${requirement.text}${evidence ? `\n${evidence}` : ""}${itemReport ? `\n${itemReport}` : ""}`
    })
    .join("\n")
    .slice(0, MAX_RESULT_CHARS)
}
