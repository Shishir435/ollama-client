import type {
  AgentCompletionReview,
  AgentEvidenceRecord,
  AgentRunState,
  AgentTaskRequirement
} from "@ollama-client/contracts"
import { MAX_AGENT_REVIEW_SOURCES } from "@ollama-client/contracts"
import type {
  AgentCompletionJudgement,
  AgentCompletionOutcomeClaim,
  AgentCompletionReviewScope
} from "./completion"
import type { AgentCompletionReviewRequest } from "./ports"

/**
 * Review requests one run may send, retries inside the port not counted.
 *
 * A reviewer is a second model call, and it is paid for only where the
 * deterministic judge could not decide. A run whose claims keep needing review
 * is a run whose evidence is not improving; after this many the claim goes
 * back to the ordinary refusal path, which asks the user.
 */
export const MAX_AGENT_COMPLETION_REVIEWS = 3

type NeedsReview = Extract<AgentCompletionJudgement, { type: "refused" }> & {
  review: AgentCompletionReviewScope
}

export const agentCompletionNeedsReview = (
  judgement: AgentCompletionJudgement
): judgement is NeedsReview =>
  judgement.type === "refused" &&
  judgement.reason === "needs_review" &&
  judgement.review !== undefined &&
  judgement.review.requirementIds.length +
    judgement.review.constraintIds.length >
    0

/**
 * The fresh context a reviewer gets: only the undecided ids, the acting
 * model's claims about those ids, and the grounded ledger. Records the
 * runtime never grounded — the model's own inferences and inputs — are left
 * out, so a reviewer cannot be persuaded by the claimant's own words.
 */
export const agentCompletionReviewRequest = (
  state: Pick<AgentRunState, "goal" | "requirements" | "constraints">,
  scope: AgentCompletionReviewScope,
  outcomes: readonly AgentCompletionOutcomeClaim[] | undefined,
  evidenceLedger: readonly AgentEvidenceRecord[]
): AgentCompletionReviewRequest => {
  const requirements = (state.requirements ?? []).filter((requirement) =>
    scope.requirementIds.includes(requirement.id)
  )
  return {
    goal: state.goal,
    requirements,
    constraints: (state.constraints ?? []).filter((constraint) =>
      scope.constraintIds.includes(constraint.id)
    ),
    claims: (outcomes ?? []).filter((claim) =>
      scope.requirementIds.includes(claim.id)
    ),
    evidenceLedger: evidenceLedger.filter(groundedRecord)
  }
}

const groundedRecord = (record: AgentEvidenceRecord): boolean =>
  (record.kind === "observed_fact" || record.kind === "verified_effect") &&
  (record.validity === "current" || record.validity === "historical")

/**
 * Whether a cited record can stand behind this id. Read by the runtime, never
 * taken from the reviewer: a record grounded for another requirement is
 * plausible evidence of the wrong thing, and a read is answered by what the
 * page said, not by an effect the run had.
 */
const supports = (
  record: AgentEvidenceRecord,
  id: string,
  requirement: AgentTaskRequirement | undefined
): boolean =>
  groundedRecord(record) &&
  (requirement === undefined ||
    ((record.requirementId === undefined || record.requirementId === id) &&
      (requirement.kind !== "read" || record.kind === "observed_fact")))

export interface AgentCompletionReviewResult {
  judgement: AgentCompletionJudgement
  /** Claimed-met ids the reviewer did not support, for telemetry. */
  disagreements: number
}

const idList = (ids: readonly string[]): string => ids.join(", ")

/**
 * Turns a reviewer's answer into a judgement the controller already knows how
 * to settle.
 *
 * Every listed id must come back `supported` with at least one citation the
 * runtime accepts, or nothing moves. A contradiction is a contradiction
 * whether or not it cites anything — it can only stop a success, never make
 * one. An id the reviewer skipped, answered twice, or supported with
 * evidence that cannot support it is insufficient. Ids nobody asked about are
 * ignored, so a reviewer cannot add, remove or rewrite a requirement.
 */
export const applyAgentCompletionReview = (
  pending: NeedsReview,
  request: AgentCompletionReviewRequest,
  review: AgentCompletionReview
): AgentCompletionReviewResult => {
  const scope = pending.review
  const asked = [...scope.requirementIds, ...scope.constraintIds]
  const answers = new Map<string, AgentCompletionReview["verdicts"][number]>()
  const repeated = new Set<string>()
  for (const verdict of review.verdicts) {
    if (!asked.includes(verdict.id)) continue
    if (answers.has(verdict.id)) repeated.add(verdict.id)
    answers.set(verdict.id, verdict)
  }
  const ledger = new Map(
    request.evidenceLedger.map((record) => [record.id, record])
  )
  const contradicted: string[] = []
  const insufficient: string[] = []
  for (const id of asked) {
    const answer = repeated.has(id) ? undefined : answers.get(id)
    if (answer?.verdict === "contradicted") {
      contradicted.push(id)
      continue
    }
    const requirement = request.requirements.find((entry) => entry.id === id)
    const cited = (answer?.sources ?? [])
      .slice(0, MAX_AGENT_REVIEW_SOURCES)
      .map((source) => ledger.get(source))
      .filter((record): record is AgentEvidenceRecord => record !== undefined)
    if (
      answer?.verdict !== "supported" ||
      !cited.some((record) => supports(record, id, requirement))
    )
      insufficient.push(id)
  }
  const disagreements = contradicted.length + insufficient.length
  if (contradicted.length > 0)
    return {
      disagreements,
      judgement: {
        type: "refused",
        reason: "contradicted_state",
        feedback: `Independent review found retained evidence contradicting ${idList(contradicted)}. Read fresh evidence before considering any further action; report the outcome unmet if the page confirms it. Do not repeat a completed effect.`
      }
    }
  if (insufficient.length > 0)
    return {
      disagreements,
      judgement: {
        ...pending,
        feedback: `Independent review found no grounded support for ${idList(insufficient)}. Quote the current page text that shows it, or report it unmet. Preserve completed effects; do not repeat an action to produce evidence.`
      }
    }
  const outcome = {
    met: [...scope.outcome.met, ...scope.requirementIds],
    unmet: scope.outcome.unmet
  }
  return {
    disagreements: 0,
    judgement:
      outcome.unmet.length === 0
        ? { type: "accepted", outcome }
        : outcome.met.length === 0
          ? { type: "unmet", outcome }
          : { type: "partial", outcome }
  }
}
