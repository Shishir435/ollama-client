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
export const agentObservationStates = (
  claim: string,
  observation: AgentObservation
): boolean => {
  const needle = claim.replaceAll(/\s+/g, " ").trim().toLocaleLowerCase()
  if (!needle) return false
  const haystack = [
    observation.title,
    observation.visibleText,
    observation.documentText ?? "",
    ...observation.elements.flatMap((element) =>
      [element.name, element.value].filter(
        (value): value is string => value !== undefined
      )
    )
  ]
    .join(" ")
    .replaceAll(/\s+/g, " ")
    .toLocaleLowerCase()
  return haystack.includes(needle)
}
