import type {
  AgentCompletionReview,
  AgentEvidenceRecord,
  AgentObservation,
  AgentRunState,
  AgentTaskConstraint,
  AgentTaskRequirement
} from "@ollama-client/contracts"
import { MAX_AGENT_REVIEW_SOURCES } from "@ollama-client/contracts"
import type {
  AgentCompletionJudgement,
  AgentCompletionOutcomeClaim,
  AgentCompletionReviewScope
} from "./completion"
import { AGENT_NEW_TAB_PATTERN, agentExclusionNamesActions } from "./completion"
import { agentFactPageLink } from "./completion-support"
import { agentHaystackStates } from "./observed-text"
import { agentTabOpensPageItem } from "./plan-page-items"
import type {
  AgentCompletionReviewRequest,
  AgentReviewedAction,
  AgentStepReadout
} from "./ports"
import { agentTextNamesRecord } from "./row-context"

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

/**
 * The ids the run's last review left contradicted, read from its receipts:
 * the newest receipt recording them, unless a user answer came after it —
 * the user's answer is a newer reading than the reviewer's. Undefined when
 * no receipt says.
 */
export const agentRecordedContradictions = (
  steps: readonly AgentStepReadout[] | undefined,
  answeredAt = 0
): Set<string> | undefined => {
  const recorded = [...(steps ?? [])]
    .filter((step) => step.reviewContradicted !== undefined)
    .sort((a, b) => a.sequence - b.sequence)
    .at(-1)
  if (!recorded || recorded.at < answeredAt) return undefined
  return new Set(recorded.reviewContradicted)
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
  appliedActions?: readonly AgentReviewedAction[],
  observation?: Pick<AgentObservation, "title" | "visibleText">,
  /** The run's receipts, to name the link each fact's page was opened from. */
  steps?: readonly AgentStepReadout[]
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
  /**
   * The outcomes already met at a higher tier than claimed, for a reviewer
   * to contradict if it can. Only from a graded outcome: on an ungraded one
   * every met id would read as verified.
   */
  const claimedIds = new Set(scope.outcome.claimed ?? [])
  const checked = scope.outcome.graded
    ? (state.requirements ?? []).filter(
        (requirement) =>
          scope.outcome.met.includes(requirement.id) &&
          !claimedIds.has(requirement.id) &&
          !scope.requirementIds.includes(requirement.id)
      )
    : []
  const openedFrom = Object.fromEntries(
    grounded.flatMap((record) => {
      if (record.kind !== "observed_fact") return []
      const link = agentFactPageLink(record, steps)
      return link ? [[record.id, link.slice(0, MAX_REVIEW_LINK_CHARS)]] : []
    })
  )
  const plan = state.requirements ?? []
  const readsOnly =
    plan.length > 0 && plan.every((requirement) => requirement.kind === "read")
  return {
    ...(appearedAfterAction ? { appearedAfterAction } : {}),
    ...(Object.keys(openedFrom).length ? { openedFrom } : {}),
    ...(readsOnly
      ? { answerIds: plan.map((requirement) => requirement.id) }
      : {}),
    ...(actions?.length ? { actions } : {}),
    ...(checked.length ? { checked } : {}),
    ...(limits ? { actionsComplete: true } : {}),
    goal: state.goal,
    requirements,
    constraints: (state.constraints ?? []).filter((constraint) =>
      scope.constraintIds.includes(constraint.id)
    ),
    /**
     * For a change, the claim is whether the other model says it is met, and
     * no more: its evidence text is its own words, and a reviewer handed
     * "Saved successfully, as the page shows" is being argued with, not
     * shown a fact. What the page said reaches it through the ledger. A read
     * keeps its text, because there the text is the answer being judged.
     */
    claims: (outcomes ?? [])
      .filter((claim) => scope.requirementIds.includes(claim.id))
      .map((claim) =>
        requirements.find((requirement) => requirement.id === claim.id)
          ?.kind === "read"
          ? claim
          : {
              id: claim.id,
              met: claim.met,
              ...(claim.items?.length
                ? {
                    items: claim.items.map(({ index, met }) => ({
                      index,
                      met
                    }))
                  }
                : {})
            }
      ),
    evidenceLedger: grounded,
    ...(observation
      ? {
          page: {
            title: observation.title.slice(0, MAX_REVIEW_PAGE_TITLE_CHARS),
            text: observation.visibleText.slice(0, MAX_REVIEW_PAGE_TEXT_CHARS)
          }
        }
      : {})
  }
}

/** How much of a followed link's name a reviewer is shown beside a fact. */
const MAX_REVIEW_LINK_CHARS = 120

/** How much of the completed-on page a reviewer is shown, as context only. */
const MAX_REVIEW_PAGE_TITLE_CHARS = 200
const MAX_REVIEW_PAGE_TEXT_CHARS = 4_000

type Settled = Exclude<AgentCompletionJudgement, { type: "refused" }>

/**
 * The scope for a completion the judge accepted with claimed outcomes: the
 * reads whose quote nothing tied to the question. A reviewer is the only
 * thing that can carry one further, and only to `supported`. Screenshot
 * reads are not offered: a picture's words are the model's own, and no
 * ledger record could support them.
 */
export const agentClaimedReviewScope = (
  judgement: AgentCompletionJudgement,
  requirements: readonly AgentTaskRequirement[] | undefined
): NeedsReview | undefined => {
  /**
   * An accepted completion only. A partial one goes on to be challenged as
   * early or settles partial whatever a review says, and a review spent on it
   * is one a later undecided claim cannot have.
   */
  if (judgement.type !== "accepted") return undefined
  /**
   * Reads only. A save is claimed because nothing read it back, and no
   * verdict on the facts already gathered can supply a page never loaded.
   */
  const reads = (judgement.outcome?.claimed ?? []).filter(
    (id) =>
      requirements?.find((requirement) => requirement.id === id)?.kind ===
      "read"
  )
  if (!reads.length || !judgement.outcome) return undefined
  return {
    type: "refused",
    reason: "needs_review",
    feedback: "",
    review: {
      requirementIds: reads,
      constraintIds: [],
      outcome: judgement.outcome
    }
  }
}

/**
 * A review of claimed outcomes. They are already met; what a review decides
 * is how far they are believed. A supported verdict the runtime can check
 * moves an id from claimed to supported. A contradicted one stops the
 * completion, exactly as it would a needs-review claim. Anything else leaves
 * it claimed: no review is not a demotion, and not a pass either.
 */
export const applyAgentClaimedReview = (
  judgement: Settled,
  pending: NeedsReview,
  request: AgentCompletionReviewRequest,
  review: AgentCompletionReview
): AgentCompletionReviewResult => {
  const whole = applyAgentCompletionReview(pending, request, review)
  if (
    whole.judgement.type === "refused" &&
    whole.judgement.reason === "contradicted_state"
  )
    return whole
  /**
   * Each id on its own, through the same checks a needs-review claim gets:
   * one unsupported read must not hold back another the reviewer did support.
   */
  const carried = pending.review.requirementIds.filter(
    (id) =>
      applyAgentCompletionReview(
        { ...pending, review: { ...pending.review, requirementIds: [id] } },
        request,
        review
      ).judgement.type !== "refused"
  )
  const outcome = judgement.outcome ?? { met: [], unmet: [] }
  const supported = [...new Set([...(outcome.supported ?? []), ...carried])]
  const claimed = (outcome.claimed ?? []).filter((id) => !carried.includes(id))
  const { met, unmet, items, visual, graded } = outcome
  return {
    disagreements: pending.review.requirementIds.length - carried.length,
    judgement: {
      ...judgement,
      outcome: {
        met,
        unmet,
        ...(items ? { items } : {}),
        ...(visual ? { visual } : {}),
        ...(supported.length ? { supported } : {}),
        ...(claimed.length ? { claimed } : {}),
        ...(graded ? { graded } : {})
      }
    }
  }
}

/**
 * A review's downgrades: every checked outcome the reviewer called
 * contradicted, once and citing at least one record the request carried,
 * moved from verified or supported to claimed. A reviewer can lower any
 * tier this way, never raise one, and never turn an accepted completion
 * into a refusal over an outcome the runtime itself checked — the runtime's
 * check still happened; what the review takes away is the confidence shown
 * for it.
 */
export const applyAgentReviewDowngrades = (
  judgement: AgentCompletionJudgement,
  request: AgentCompletionReviewRequest,
  review: AgentCompletionReview
): { judgement: AgentCompletionJudgement; downgraded: string[] } => {
  if (judgement.type === "refused" || !judgement.outcome || !request.checked)
    return { judgement, downgraded: [] }
  const ledger = new Set(request.evidenceLedger.map((record) => record.id))
  const counts = new Map<string, number>()
  for (const verdict of review.verdicts)
    counts.set(verdict.id, (counts.get(verdict.id) ?? 0) + 1)
  const outcome = judgement.outcome
  const downgraded = request.checked
    .map((requirement) => requirement.id)
    .filter(
      (id) =>
        counts.get(id) === 1 &&
        outcome.met.includes(id) &&
        review.verdicts.some(
          (verdict) =>
            verdict.id === id &&
            verdict.verdict === "contradicted" &&
            verdict.sources
              .slice(0, MAX_AGENT_REVIEW_SOURCES)
              .some((source) => ledger.has(source))
        )
    )
  if (!downgraded.length) return { judgement, downgraded }
  const supported = (outcome.supported ?? []).filter(
    (id) => !downgraded.includes(id)
  )
  const claimed = [...new Set([...(outcome.claimed ?? []), ...downgraded])]
  const { met, unmet, items, visual, graded } = outcome
  return {
    downgraded,
    judgement: {
      ...judgement,
      outcome: {
        met,
        unmet,
        ...(items ? { items } : {}),
        ...(visual ? { visual } : {}),
        ...(supported.length ? { supported } : {}),
        claimed,
        ...(graded ? { graded } : {})
      }
    }
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
  if (!groundedRecord(record)) return false
  /**
   * A tab at a page item's own link is that item's citation, tagged or not:
   * its address names the item. Whether opening it is all the item asks
   * for is the reviewer's verdict.
   */
  if (
    requirement?.id === id &&
    requirement.kind === "change" &&
    (requirement.items ?? []).some((_, index) =>
      agentTabOpensPageItem(record, requirement, index)
    )
  )
    return true
  /**
   * A read is answered by what the page said, wherever the run first met it:
   * a fact retained for r1 can ground r2's answer, and a quote the run
   * never tagged can too. The reviewer still judges whether it answers the
   * question; the tag only says where the run was looking. A change keeps
   * the strict rule — a fact for another outcome shows nothing of this one.
   */
  if (
    requirement?.id === id &&
    requirement.kind === "read" &&
    record.kind === "observed_fact"
  )
    return true
  if (record.requirementId !== id) return false
  if (record.kind === "observed_fact") return true
  return (
    requirement?.kind === "change" &&
    record.verificationKind !== undefined &&
    (RESULT_EFFECT_KINDS.has(record.verificationKind) ||
      /**
       * A tab committed at its destination is the state "open it in a new
       * tab" asks for; no page text says which tab a page is in.
       */
      (record.verificationKind === "tab" &&
        AGENT_NEW_TAB_PATTERN.test(requirement.text)))
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
/**
 * Whether a limit is answered by the actions the run recorded: one on how it
 * acted, or an exclusion of something the run itself would do. The reviewer
 * is told the same rule, so it cannot be steered to cite receipts for a limit
 * that needs a quotation of the page.
 */
export const agentLimitAnsweredByActions = (
  constraint: AgentTaskConstraint
): boolean =>
  constraint.kind === "scope" ||
  (constraint.kind === "exclude" && agentExclusionNamesActions(constraint.text))

/**
 * Whether a limit is about the answer of a run that only reads: "exclude
 * Archive", "stay under 90 credits" on a task that reports offers. No record
 * is ever bound to a limit's own id, and nothing the run did can show it, so
 * every one went to a reviewer with nothing to cite and was refused on every
 * research run. The answer's own facts show it: no excluded source among
 * them, the chosen value within the bound.
 */
export const agentLimitAnsweredByAnswer = (
  constraint: AgentTaskConstraint,
  answerIds: readonly string[] | undefined
): boolean =>
  !agentLimitAnsweredByActions(constraint) && (answerIds?.length ?? 0) > 0

/**
 * Whether a limit is a condition on the run's own behaviour: "if uncertain,
 * stop", "when asked for a password, ask me". Worded as a condition, so no
 * record of the page can be bound to it.
 */
export const agentConstraintIsConditional = (
  constraint: AgentTaskConstraint
): boolean =>
  /^(?:if|when|whenever|unless|in case|should)\b/u.test(
    constraint.text.trim().toLowerCase()
  )

/** A retained page fact bound to one of the plan's reads. */
const answerFact = (
  record: AgentEvidenceRecord,
  answerIds: readonly string[] | undefined
): boolean =>
  groundedRecord(record) &&
  record.kind === "observed_fact" &&
  record.requirementId !== undefined &&
  answerIds?.includes(record.requirementId) === true

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
): boolean => {
  const id = agentReviewRecordFor(record, requirements)
  return (
    (id !== undefined &&
      supports(
        record,
        id,
        requirements.find((entry) => entry.id === id)
      )) ||
    requirements.some(
      (entry) => entry.kind === "read" && supports(record, entry.id, entry)
    )
  )
}

/**
 * The outcome a record is evidence for: its tag, or for an untagged tab the
 * page-item outcome whose link it opened, since the address names the item.
 */
export const agentReviewRecordFor = (
  record: AgentEvidenceRecord,
  requirements: readonly AgentTaskRequirement[]
): string | undefined =>
  record.requirementId ??
  requirements.find((requirement) =>
    (requirement.items ?? []).some((_, index) =>
      agentTabOpensPageItem(record, requirement, index)
    )
  )?.id

/**
 * An itemized change reaches review only when each item already has its own
 * quote, and one verdict then answers for all of them. It counts only when
 * its citations do too: a supporting quote naming each item, so "Record 2
 * Paid" cited alone cannot carry Record 5.
 */
const citesEveryItem = (
  requirement: AgentTaskRequirement | undefined,
  cited: readonly AgentEvidenceRecord[],
  id: string
): boolean =>
  requirement?.kind !== "change" ||
  !requirement.items?.length ||
  requirement.items.every((item, index) =>
    cited.some(
      (record) =>
        (record.quote !== undefined &&
          supports(record, id, requirement) &&
          agentTextNamesRecord(record.quote, item)) ||
        /** A tab receipt names a page-link item by where it opened. */
        (requirement.id === id &&
          agentTabOpensPageItem(record, requirement, index))
    )
  )

/**
 * The one answer each asked id got. An id answered twice has no answer: a
 * reviewer that said both cannot be read as having said either.
 */
const reviewAnswers = (
  asked: readonly string[],
  review: AgentCompletionReview
): Map<string, AgentCompletionReview["verdicts"][number] | undefined> => {
  const answers = new Map<
    string,
    AgentCompletionReview["verdicts"][number] | undefined
  >()
  const seen = new Set<string>()
  for (const verdict of review.verdicts) {
    if (!asked.includes(verdict.id)) continue
    answers.set(verdict.id, seen.has(verdict.id) ? undefined : verdict)
    seen.add(verdict.id)
  }
  return answers
}

/**
 * The asked ids this review called contradicted, by the same reading
 * `applyAgentCompletionReview` gives it, and the ones it answered otherwise.
 * An id the reviewer skipped or answered twice is in neither: it said
 * nothing readable about it.
 */
export const agentReviewVerdictsOf = (
  scope: AgentCompletionReviewScope,
  review: AgentCompletionReview
): { contradicted: string[]; answered: string[] } => {
  const asked = [...scope.requirementIds, ...scope.constraintIds]
  const answers = reviewAnswers(asked, review)
  const contradicted = asked.filter(
    (id) => answers.get(id)?.verdict === "contradicted"
  )
  return {
    contradicted,
    answered: asked.filter(
      (id) => answers.get(id) !== undefined && !contradicted.includes(id)
    )
  }
}

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
  const answers = reviewAnswers(asked, review)
  const ledger = new Map(
    request.evidenceLedger.map((record) => [record.id, record])
  )
  const contradicted: string[] = []
  const insufficient: string[] = []
  for (const id of asked) {
    const answer = answers.get(id)
    if (answer?.verdict === "contradicted") {
      contradicted.push(id)
      continue
    }
    const requirement = request.requirements.find((entry) => entry.id === id)
    /**
     * Only a limit on how the run acted, or an exclusion of what it must not
     * do ("don't reorder anything else"): both are answered by the actions
     * the run recorded, which the reviewer judges against the list. A
     * `limit` such as a spending cap is about what the page shows, and a
     * confirmed click says nothing of a total; it still needs a quotation
     * bound to it. So does an exclusion about the page rather than the run's
     * own actions: any receipt passes `limitCitable`, and one for another
     * requirement says nothing of which seller was picked.
     */
    const limit =
      request.actionsComplete === true &&
      scope.constraintIds.includes(id) &&
      request.constraints.some(
        (constraint) =>
          constraint.id === id && agentLimitAnsweredByActions(constraint)
      )
    const byAnswer =
      scope.constraintIds.includes(id) &&
      request.constraints.some(
        (constraint) =>
          constraint.id === id &&
          agentLimitAnsweredByAnswer(constraint, request.answerIds)
      )
    /**
     * A condition on how the run behaves — "if uncertain, stop" — names no
     * outcome and no page text, so nothing is ever bound to its id and the
     * citation rule could only refuse it. The reviewer's verdict stands once
     * it cites any grounded record the run held, so it cannot be a verdict
     * on nothing.
     */
    const conditional =
      scope.constraintIds.includes(id) &&
      request.constraints.some(
        (constraint) =>
          constraint.id === id && agentConstraintIsConditional(constraint)
      )
    const cited = (answer?.sources ?? [])
      .slice(0, MAX_AGENT_REVIEW_SOURCES)
      .map((source) => ledger.get(source))
      .filter((record): record is AgentEvidenceRecord => record !== undefined)
    if (
      answer?.verdict !== "supported" ||
      !cited.some((record) =>
        conditional
          ? groundedRecord(record)
          : byAnswer
            ? answerFact(record, request.answerIds)
            : supports(record, id, requirement, limit)
      ) ||
      !citesEveryItem(requirement, cited, id)
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
        feedback: `Independent review found no grounded support for ${idList(insufficient)}. Quote the page text that shows it (for a read, a fact this run already retained counts; do not reopen a page to quote it again), or report it unmet. Preserve completed effects; do not repeat an action to produce evidence.`
      }
    }
  /**
   * What the reviewer carried is supported, never verified: the reviewer is
   * a model, and a model's verdict is the second tier at most.
   */
  const supported = [
    ...(scope.outcome.supported ?? []),
    ...scope.requirementIds
  ]
  const outcome = {
    ...scope.outcome,
    met: [...scope.outcome.met, ...scope.requirementIds],
    ...(supported.length ? { supported } : {})
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
