import type { AgentTaskRequirement } from "@ollama-client/contracts"

import type { AgentCompletionOutcomeClaim } from "./completion"
import { agentNormalizedClaim } from "./observed-text"

/** The run record's own ceiling; the summary is cut before anything is added. */
const MAX_RESULT_CHARS = 20_000

/**
 * The result a completed run reports: its summary, followed by what each met
 * read requirement quoted from the page when the summary does not already say
 * it.
 *
 * A model's summary can describe finding a value without stating it —
 * "Opened Details and found the status code." — while the outcome it
 * completed with carried "Status code: ZX-482", quoted from the page and
 * checked there. Only the summary was kept, so the chat that delegated the
 * task told the user the code was not in the result. The quotation is page
 * text the completion gate already confirmed is on the page, and it stays as
 * untrusted as every other part of the result.
 */
export const agentRunResult = (
  summary: string,
  requirements: readonly AgentTaskRequirement[] | undefined,
  outcomes: readonly AgentCompletionOutcomeClaim[] | undefined,
  met: readonly string[] | undefined
): string => {
  const said = agentNormalizedClaim(summary)
  const findings = (requirements ?? [])
    .filter(
      (requirement) =>
        requirement.kind === "read" && (met ?? []).includes(requirement.id)
    )
    .map((requirement) =>
      outcomes?.find((claim) => claim.id === requirement.id)?.evidence?.trim()
    )
    .filter(
      (evidence): evidence is string =>
        evidence !== undefined &&
        evidence.length > 0 &&
        !said.includes(agentNormalizedClaim(evidence))
    )
  const unique = [...new Set(findings)]
  const result = unique.length ? `${summary}\n${unique.join("\n")}` : summary
  return result.slice(0, MAX_RESULT_CHARS)
}
