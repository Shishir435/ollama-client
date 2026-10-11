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
import { agentHaystackStates } from "./observed-text"
import type {
  AgentCompletionReviewRequest,
  AgentReviewedAction,
  AgentStepReadout
} from "./ports"

/**
 * Review requests one run may send, retries inside the port not counted.
 *
 * A reviewer is a second model call, and it is paid for only where the
 * deterministic judge could not decide. A run whose claims keep needing review
 * is a run whose evidence is not improving; after this many the claim goes
 * back to the ordinary refusal path, which asks the user.
 */
export const MAX_AGENT_COMPLETION_REVIEWS = 3

/**
 * Reviews the run has already paid for, read from its receipts.
 *
 * A step's receipts each carry its running total, so the last one per step is
 * the step's count and earlier ones are not added again.
 */
export const agentRecordedReviews = (
  steps: readonly AgentStepReadout[] | undefined
): number => {
  const latest = new Map<string, AgentStepReadout>()
  for (const step of [...(steps ?? [])].sort((a, b) => a.sequence - b.sequence))
    latest.set(step.stepId, step)
  let reviews = 0
  for (const step of latest.values()) reviews += step.telemetry?.reviews ?? 0
  return reviews
}

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
  evidenceLedger: readonly AgentEvidenceRecord[],
  /**
   * Per requirement, the page before its own verified change and, once the
   * run changed something else, the page just before that, with the actions
   * applied in between.
   */
  actionWindows?: ReadonlyMap<
    string,
    {
      before: string
      after?: string
      actions?: readonly Omit<AgentReviewedAction, "requirementId">[]
    }
  >,
  /**
   * Every change the run applied, from its receipts, tagged or not. Used for
   * a scope limit instead of the windows, which keep only verified actions
   * bound to an outcome.
   */
  appliedActions?: readonly AgentReviewedAction[]
): AgentCompletionReviewRequest => {
  const requirements = (state.requirements ?? []).filter((requirement) =>
    scope.requirementIds.includes(requirement.id)
  )
  const grounded = evidenceLedger.filter(groundedRecord)
  /**
   * Text that first appeared after the verified action bound to the same
   * requirement, and before the run changed anything else. A reviewer asked
   * whether "Continue is clicked" was met, shown only "Status: Active",
   * rightly answered that the quote did not show a click — every such run was
   * refused twice and asked the user about work it had finished. A status
   * line that appeared right after that click is the click's evidence. A
   * line some other step produced, or one already there, is not, so the
   * window is the requirement's own and not the run's first change.
   */
  const appearedAfterAction =
    actionWindows === undefined
      ? undefined
      : grounded
          .filter((record) => {
            const window = record.requirementId
              ? actionWindows.get(record.requirementId)
              : undefined
            return (
              window !== undefined &&
              record.kind === "observed_fact" &&
              record.validity === "current" &&
              record.quote !== undefined &&
              !agentHaystackStates(record.quote, window.before) &&
              (window.after === undefined ||
                agentHaystackStates(record.quote, window.after))
            )
          })
          .map((record) => record.id)
  /**
   * A limit on how the run acted — a key, a method, staying on one form — is
   * about every action it took, so a limit under review sees every applied
   * receipt, tagged or not, each labelled with the outcome it served.
   */
  const limits = scope.constraintIds.length > 0 && appliedActions !== undefined
  const actions = limits
    ? appliedActions
    : actionWindows
      ? requirements.flatMap((requirement) =>
          (actionWindows.get(requirement.id)?.actions ?? []).map((action) => ({
            requirementId: requirement.id,
            ...action
          }))
        )
      : undefined
  return {
    ...(appearedAfterAction ? { appearedAfterAction } : {}),
    ...(actions?.length ? { actions } : {}),
    ...(limits ? { actionsComplete: true } : {}),
    goal: state.goal,
    requirements,
    constraints: (state.constraints ?? []).filter((constraint) =>
      scope.constraintIds.includes(constraint.id)
    ),
    claims: (outcomes ?? []).filter((claim) =>
      scope.requirementIds.includes(claim.id)
    ),
    evidenceLedger: grounded
  }
}

const groundedRecord = (record: AgentEvidenceRecord): boolean =>
  (record.kind === "observed_fact" || record.kind === "verified_effect") &&
  (record.validity === "current" || record.validity === "historical")

/**
 * Effect kinds that prove the resulting state rather than a reaction: the
 * control holds the value, the box the checked state, the item its place,
 * the page the state `wait` named. `activation`, `submission` and
 * `navigation` only say the input landed, and cannot show a save completed.
 * The same set the deterministic judge reads, for the same reason.
 */
const RESULT_EFFECT_KINDS = new Set([
  "field",
  "fields",
  "checked",
  "arrangement",
  "condition"
])

/**
 * Whether a cited record can stand behind this id. Read by the runtime, never
 * taken from the reviewer.
 *
 * The record must be bound to exactly this id: an unbound fact is plausible
 * evidence of anything, which is the same as evidence of nothing in
 * particular. A read and a limit are shown by what the page said. A change
 * may also be shown by a verified effect, but only one whose kind proves the
 * resulting state.
 */
const supports = (
  record: AgentEvidenceRecord,
  id: string,
  requirement: AgentTaskRequirement | undefined,
  limit = false
): boolean => {
  if (limit && limitCitable(record)) return true
  if (!groundedRecord(record) || record.requirementId !== id) return false
  if (record.kind === "observed_fact") return true
  return (
    requirement?.kind === "change" &&
    record.verificationKind !== undefined &&
    RESULT_EFFECT_KINDS.has(record.verificationKind)
  )
}

/**
 * A confirmed action the runtime itself recorded, citable for a `scope` limit
 * — one on how the run acted. A limit names no outcome, so no record is ever bound to its
 * id, and a page quote cannot show which key was pressed: without this, every
 * limit the planner wrote about method could only ever be refused, and the
 * run asked the user about work it had finished the way it was told to. Only
 * a runtime verification, never the acting model's own words, and the
 * reviewer must still judge it against the listed actions.
 */
const limitCitable = (record: AgentEvidenceRecord): boolean =>
  groundedRecord(record) && record.kind === "verified_effect"

/** Whether a record can be cited for a limit under review; see `limitCitable`. */
export const agentReviewRecordCitableForLimits = limitCitable

/**
 * Whether the runtime will accept a record as a citation for the outcome it
 * belongs to. The reviewer is shown this beside every record, computed by the
 * same rule `applyAgentCompletionReview` applies, so the two cannot disagree:
 * a reviewer that cited the verified click behind a change it rightly judged
 * done had every completion it supported refused, and the run asked the user
 * about work it had finished.
 */
export const agentReviewRecordCitable = (
  record: AgentEvidenceRecord,
  requirements: readonly AgentTaskRequirement[]
): boolean =>
  record.requirementId !== undefined &&
  supports(
    record,
    record.requirementId,
    requirements.find((entry) => entry.id === record.requirementId)
  )

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
    /**
     * Only a limit on how the run acted. A `limit` such as a spending cap is
     * about what the page shows, and a confirmed click says nothing of a
     * total; it still needs a quotation bound to it.
     */
    const limit =
      request.actionsComplete === true &&
      scope.constraintIds.includes(id) &&
      request.constraints.some(
        (constraint) => constraint.id === id && constraint.kind === "scope"
      )
    const cited = (answer?.sources ?? [])
      .slice(0, MAX_AGENT_REVIEW_SOURCES)
      .map((source) => ledger.get(source))
      .filter((record): record is AgentEvidenceRecord => record !== undefined)
    if (
      answer?.verdict !== "supported" ||
      !cited.some((record) => supports(record, id, requirement, limit))
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
    unmet: scope.outcome.unmet,
    ...(scope.outcome.visual?.length ? { visual: scope.outcome.visual } : {})
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
