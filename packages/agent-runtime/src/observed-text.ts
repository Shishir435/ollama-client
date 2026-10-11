import type { AgentObservation } from "@ollama-client/contracts"

/**
 * Whether a phrase is actually on the page the run just observed.
 *
 * The one question two different rules ask: `wait` asks whether the condition
 * it named has appeared, and a completion asks whether the evidence it cites
 * is really there. Both are the same claim — the model said a string would be
 * visible, and the observation either shows it or does not — so both read it
 * the same way. A second copy would let a run complete on evidence its own
 * `wait` would have rejected.
 *
 * Everything the page rendered counts: its title, the viewport text, the
 * below-fold document text when the observation carried it, and the names and
 * values of the controls it listed. Whitespace is collapsed and case is
 * folded, because neither is something a model can be asked to reproduce
 * exactly from a rendered page.
 */

/** One page, flattened to the text a claim about it is matched against. */
export const agentObservationHaystack = (
  observation: AgentObservation
): string =>
  [
    observation.title,
    observation.visibleText,
    observation.documentText ?? "",
    observation.textPage?.text ?? "",
    ...observation.elements.flatMap((element) =>
      [element.name, element.value].filter(
        (value): value is string => value !== undefined
      )
    )
  ]
    .join(" ")
    .replaceAll(/\s+/g, " ")
    .toLocaleLowerCase()

/** The comparable form of a phrase a model wrote about a page. */
export const agentNormalizedClaim = (claim: string): string =>
  claim.replaceAll(/\s+/g, " ").trim().toLocaleLowerCase()

export const agentHaystackStates = (
  claim: string,
  haystack: string
): boolean => {
  const needle = agentNormalizedClaim(claim)
  if (!needle) return false
  const escaped = needle.replaceAll(/[.*+?^${}()|[\]\\]/g, "\\$&")
  // Unicode word boundaries keep Closed distinct from disclosed and Invoice 1
  // distinct from Invoice 10. Punctuation in a quotation remains literal.
  return new RegExp(
    `(?<![\\p{L}\\p{N}_])${escaped}(?![\\p{L}\\p{N}_])`,
    "u"
  ).test(haystack)
}

export const agentObservationStates = (
  claim: string,
  observation: AgentObservation
): boolean => agentHaystackStates(claim, agentObservationHaystack(observation))
