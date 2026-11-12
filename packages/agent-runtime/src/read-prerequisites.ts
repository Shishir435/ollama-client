import type {
  AgentDecision,
  AgentTaskRequirement
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
  effect: ResolvedAgentEffect
): AgentTaskRequirement[] => {
  const ids = new Set(
    agentEffectIsConsequential(effect)
      ? requirements.flatMap((entry) => entry.requires ?? [])
      : []
  )
  return requirements.filter(
    (entry) =>
      entry.kind === "read" &&
      ((entry.beforeChanges && agentWriteNeedsPrerequisites(effect)) ||
        ids.has(entry.id))
  )
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
