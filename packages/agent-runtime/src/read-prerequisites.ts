import {
  type AgentDecision,
  type AgentTaskRequirement,
  MAX_AGENT_EVIDENCE_CHARS
} from "@ollama-client/contracts"
import { judgeAgentCompletion, type AgentCompletionInput } from "./completion"
import type { ResolvedAgentEffect } from "./ports"
import { agentEffectIsConsequential } from "./prior-effects"

/** Reading/navigation stays possible; resolved edits and commits owe the read phase. */
export const agentWriteNeedsPrerequisites = (
  effect: ResolvedAgentEffect
): boolean =>
  agentEffectIsConsequential(effect) ||
  effect.semanticEffects.includes("form_mutation") ||
  effect.semanticEffects.includes("drag")

/**
 * A model tag cannot prove an effect independent of a pending dependency.
 * Until effects can be bound to semantic outcomes, every commit owes the
 * plan's dependent reads. Preparatory mutations owe only explicit read phases.
 */
export const agentRequiredReads = (
  requirements: readonly AgentTaskRequirement[],
  effect: ResolvedAgentEffect,
  /**
   * The change the step is tagged to, and every change that has already
   * attempted a commit. The tag alone exempts nothing: see `producesRead`.
   */
  step: { requirementId?: string; attempted?: ReadonlySet<string> } = {}
): AgentTaskRequirement[] => {
  const ids = new Set(
    agentEffectIsConsequential(effect)
      ? requirements
          .flatMap((entry) => entry.requires ?? [])
          .filter(
            (id) =>
              !producesRead(
                requirements,
                id,
                step,
                effect.target.accessibleName
              )
          )
      : []
  )
  return requirements.filter(
    (entry) =>
      entry.kind === "read" &&
      ((entry.beforeChanges && agentWriteNeedsPrerequisites(effect)) ||
        ids.has(entry.id))
  )
}

/** Words that say nothing about which action a control performs. */
const FILLER = new Set([
  "the",
  "and",
  "for",
  "this",
  "that",
  "with",
  "from",
  "into",
  "your",
  "our",
  "its",
  "now",
  "then",
  "once",
  "all",
  "any",
  "one",
  "button",
  "link",
  "page",
  "here"
])

/** Lower-case words of three or more letters, stripped of common inflection. */
const actionWords = (text: string | undefined): Set<string> =>
  new Set(
    (text ?? "")
      .toLocaleLowerCase()
      .split(/[^\p{L}\p{N}]+/u)
      .filter((word) => word.length >= 3 && !FILLER.has(word))
      .map((word) => {
        const stem = word.replace(/(?:ing|ed|s)$/u, "")
        return stem.length < 3 ? word : stem.replace(/([^aeiou])\1$/u, "$1")
      })
  )

/**
 * Whether a commit dependency on a read is one this step must produce first.
 * In "submit a quote request, read the returned quote, accept it", the
 * accept owes the read, and the read can only exist after the submit: owing
 * it on the submit held the run where nothing could release it.
 *
 * A requirement tag is the model's word, and a model can file the accept
 * under the submit. So the exemption is bound to the control itself, as the
 * runtime resolved it: its accessible name must use a word of the producing
 * change's own action that no dependent change uses, and none of a
 * dependent change's own words. "Accept" tagged to the submit names no word
 * of the submit's and the accept's own, so it still owes the read. The step
 * must also be tagged to a change listed before the read that does not
 * itself depend on it, and that change must not have attempted a commit,
 * so the exemption carries one commit at most. Anything else — an unnamed
 * control, a label both changes share, no other change depending on the
 * read — owes every dependency.
 */
const producesRead = (
  requirements: readonly AgentTaskRequirement[],
  readId: string,
  step: { requirementId?: string; attempted?: ReadonlySet<string> },
  label: string | undefined
): boolean => {
  if (!step.requirementId || step.attempted?.has(step.requirementId))
    return false
  const own = requirements.findIndex(({ id }) => id === step.requirementId)
  const read = requirements.findIndex(({ id }) => id === readId)
  const change = requirements[own]
  if (
    own < 0 ||
    read <= own ||
    change.kind !== "change" ||
    change.requires?.includes(readId) ||
    change.beforeChanges
  )
    return false
  const dependents = requirements.filter(
    (entry) =>
      entry.id !== change.id &&
      entry.kind === "change" &&
      entry.requires?.includes(readId)
  )
  if (dependents.length === 0) return false
  const named = actionWords(label)
  const producing = actionWords(change.text)
  const dependent = new Set(
    dependents.flatMap((entry) => [...actionWords(entry.text)])
  )
  return (
    [...named].some((word) => producing.has(word) && !dependent.has(word)) &&
    ![...named].some((word) => dependent.has(word) && !producing.has(word))
  )
}

type PrerequisiteOutcomes = Extract<
  AgentDecision,
  { type: "command" }
>["prerequisiteOutcomes"]

/**
 * One answer per read. A model that read a prerequisite over two pages
 * answered it twice, one entry per page, and the count check below refused
 * the commit every time without saying why. Entries for one id that are all
 * met, carry no per-item answers and fit one evidence field are the same
 * answer in two pieces: they are joined the way a single answer joins quotes
 * from several sources, and judged as one. Each quote is still grounded on
 * its own. Anything else is left as sent, and refused.
 */
export const agentMergedPrerequisiteOutcomes = (
  outcomes: PrerequisiteOutcomes
): PrerequisiteOutcomes => {
  if (
    !outcomes ||
    new Set(outcomes.map(({ id }) => id)).size === outcomes.length
  )
    return outcomes
  const merged: NonNullable<PrerequisiteOutcomes>[number][] = []
  for (const id of new Set(outcomes.map((claim) => claim.id))) {
    const same = outcomes.filter((claim) => claim.id === id)
    const evidence = [
      ...new Set(same.flatMap((claim) => claim.evidence ?? []))
    ].join("; ")
    if (
      same.length === 1 ||
      same.some((claim) => !claim.met || claim.items) ||
      !evidence ||
      evidence.length > MAX_AGENT_EVIDENCE_CHARS
    )
      merged.push(...same)
    else merged.push({ ...same[0], evidence })
  }
  return merged
}

/** Explicit answers are judged as reads, never inferred from workflow support. */
export const judgeAgentReadPrerequisites = (
  requirements: readonly AgentTaskRequirement[],
  outcomes: Extract<AgentDecision, { type: "command" }>["prerequisiteOutcomes"],
  input: Pick<
    AgentCompletionInput,
    | "observation"
    | "steps"
    | "evidenceLedger"
    | "startedAt"
    | "summary"
    | "planVersion"
  >
) => {
  const ids = new Set(requirements.map(({ id }) => id))
  const repeated = [
    ...new Set(
      (outcomes ?? [])
        .map(({ id }) => id)
        .filter((id, index, all) => all.indexOf(id) !== index)
    )
  ]
  if (repeated.length)
    return {
      type: "refused" as const,
      reason: "missing_outcomes" as const,
      feedback: `prerequisiteOutcomes answers ${repeated.join(", ")} more than once. Give exactly one entry per read; when its evidence spans several pages, join the retained quotes with "; " in that one entry's evidence. Navigation and inspection remain available.`
    }
  if (
    !outcomes ||
    outcomes.length !== ids.size ||
    new Set(outcomes.map(({ id }) => id)).size !== ids.size ||
    outcomes.some((claim) => !ids.has(claim.id) || !claim.met) ||
    input.steps === undefined
  )
    return {
      type: "refused" as const,
      reason: "missing_outcomes" as const,
      feedback: `Before editing or committing, answer every read-before-write prerequisite (${[...ids].join(", ")}) in prerequisiteOutcomes with grounded evidence. Unknown, missing or unmet reads do not authorize a write. Navigation and inspection remain available.`
    }
  return judgeAgentCompletion({ ...input, requirements, outcomes })
}
