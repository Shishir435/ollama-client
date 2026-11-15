/**
 * What an attempt's own evidence says about how the runtime refused it: a
 * histogram of refusals by stable code, and whether durable step receipts were
 * readable. Content-free by construction. Only fixed vocabulary and counts
 * leave this module; a page quote, model text, answer or receipt summary is
 * never copied, so the result is safe in the shareable baseline.
 *
 * Two sources, both in the private evidence export. The worker trace
 * (`logs`, enabled by `__OLLAMA_CLIENT_AGENT_TRACE__`) carries machine codes:
 * `completion_refused` with its `reason`, and one `*_refused` event ahead of
 * each `command_refused`. The panel snapshots (`messages`) carry the receipts,
 * whose rejected `completion` and `resolution` steps hold free-text feedback
 * with no code. Receipts are used only to count what the trace did not name,
 * which lands in `unclassified`: a refusal the trace missed, a trace that was
 * off, or a runtime phase newer than this vocabulary.
 */

/**
 * The reasons the completion judge refuses with. A reason outside this list is
 * counted as `unclassified` instead of being copied, so a runtime change shows
 * up as a growing bucket rather than as an unreviewed label in a report.
 */
const COMPLETION_REASONS = Object.freeze([
  "unverified_change",
  "missing_evidence",
  "absent_evidence",
  "self_evidence",
  "stale_evidence",
  "missing_outcomes",
  "premature_unmet",
  "needs_review",
  "contradicted_state",
  "readback_required"
])
/** The reasons plus the completion-time warning that has a trace but no reason. */
export const COMPLETION_REFUSAL_CODES = Object.freeze([
  ...COMPLETION_REASONS,
  "unretained_sighting"
])

/** Trace phase to the code of a refused command (a `resolution` receipt). */
const RESOLUTION_PHASES = Object.freeze({
  outstanding_answer_refused: "outstanding_answer",
  wrong_row_refused: "wrong_row",
  outside_scope_refused: "outside_scope",
  constraint_refused: "constraint",
  unretained_sighting_refused: "unretained_sighting",
  read_prerequisite_refused: "read_prerequisite"
})
export const RESOLUTION_REFUSAL_CODES = Object.freeze([
  ...new Set(Object.values(RESOLUTION_PHASES))
])

const UNCLASSIFIED = "unclassified"

/**
 * Trace events that mean the run could not read its own durable receipts. Each
 * is emitted from a failed `persistence.steps` read.
 */
const RECEIPT_UNAVAILABLE_PHASES = new Set([
  "completion_receipts_unreadable",
  "history_unavailable",
  "committed_effects_unavailable",
  "authored_text_unavailable"
])

/** The structural fields of each agent trace line, in the order logged. */
const agentTraces = (logs) =>
  (Array.isArray(logs) ? logs : []).flatMap((entry) => {
    const [message, data] = entry?.args ?? []
    if (
      typeof message !== "string" ||
      !message.includes("Agent run trace") ||
      !data ||
      typeof data !== "object" ||
      typeof data.phase !== "string"
    )
      return []
    return [{ phase: data.phase, reason: data.reason, command: data.command }]
  })

/**
 * The latest receipt per step across every snapshot the panel received. A
 * snapshot already holds one receipt per step, and a step can be re-stated in
 * a later one, so the highest sequence wins.
 */
const latestSteps = (messages) => {
  const latest = new Map()
  for (const message of Array.isArray(messages) ? messages : [])
    for (const step of message?.snapshot?.steps ?? []) {
      if (typeof step?.stepId !== "string") continue
      const known = latest.get(step.stepId)
      if (!known || (step.sequence ?? 0) >= (known.sequence ?? 0))
        latest.set(step.stepId, step)
    }
  return [...latest.values()]
}

const add = (group, code) => {
  group[code] = (group[code] ?? 0) + 1
}
const total = (group) => Object.values(group).reduce((n, count) => n + count, 0)

/**
 * Refusals by code for one attempt: `completion` (the judge refused to settle)
 * and `resolution` (a command was refused before it ran), each as
 * `{ code: count }`. `traced` says whether any agent trace line existed;
 * without one every refusal is `unclassified`. `rejectedSteps` is the receipt
 * count the totals were reconciled against, kept to show the two agree.
 */
export const refusalHistogram = ({ logs, messages } = {}) => {
  const traces = agentTraces(logs)
  const completion = {}
  const resolution = {}
  /** The code of the specific refusal that precedes its `command_refused`. */
  let pending
  for (const { phase, reason, command } of traces) {
    if (phase === "completion_refused")
      add(
        completion,
        COMPLETION_REASONS.includes(reason) ? reason : UNCLASSIFIED
      )
    else if (phase === "unretained_sighting_refused" && command === "complete")
      add(completion, "unretained_sighting")
    else if (Object.hasOwn(RESOLUTION_PHASES, phase))
      pending = RESOLUTION_PHASES[phase]
    else if (phase === "command_refused") {
      add(resolution, pending ?? UNCLASSIFIED)
      pending = undefined
    }
  }
  if (pending) add(resolution, pending)
  const steps = latestSteps(messages)
  const rejectedSteps = Object.fromEntries(
    ["completion", "resolution"].map((kind) => [
      kind,
      steps.filter(
        (step) =>
          step.status === "rejected" &&
          step.verification?.evidence?.kind === kind
      ).length
    ])
  )
  for (const [kind, group] of [
    ["completion", completion],
    ["resolution", resolution]
  ]) {
    const missing = rejectedSteps[kind] - total(group)
    if (missing > 0) group[UNCLASSIFIED] = (group[UNCLASSIFIED] ?? 0) + missing
  }
  return { traced: traces.length > 0, completion, resolution, rejectedSteps }
}

const count = (value) =>
  Number.isInteger(value) && value >= 0 && value <= 1_000_000 ? value : 0

/**
 * A refusal histogram reduced to the fixed vocabulary. Used wherever a row is
 * projected for sharing, so an unexpected key or value cannot carry text.
 */
export const sanitizeRefusals = (value) => {
  if (!value || typeof value !== "object") return undefined
  const keep = (group, allowed) =>
    Object.fromEntries(
      [...allowed, UNCLASSIFIED]
        .filter((code) => count(group?.[code]) > 0)
        .map((code) => [code, count(group[code])])
    )
  return {
    traced: value.traced === true,
    completion: keep(value.completion, COMPLETION_REFUSAL_CODES),
    resolution: keep(value.resolution, RESOLUTION_REFUSAL_CODES),
    rejectedSteps: {
      completion: count(value.rejectedSteps?.completion),
      resolution: count(value.rejectedSteps?.resolution)
    }
  }
}

/** The labels `receiptAvailability` can return. */
export const RECEIPT_LABELS = Object.freeze([
  "available",
  "unavailable",
  "unobserved"
])

/**
 * Whether the run could read its durable receipts: `unavailable` when the
 * runtime traced a failed read, `available` when the panel received any step
 * receipt, `unobserved` when neither happened (no run reached the agent).
 */
export const receiptAvailability = ({ logs, messages } = {}) => {
  if (
    agentTraces(logs).some((trace) =>
      RECEIPT_UNAVAILABLE_PHASES.has(trace.phase)
    )
  )
    return "unavailable"
  return latestSteps(messages).length > 0 ? "available" : "unobserved"
}

/** The per-attempt fields both live runners and `rescore` record. */
export const traceTelemetry = (evidence) => ({
  refusals: refusalHistogram(evidence),
  receipts: receiptAvailability(evidence)
})

/**
 * One label for a pass from its attempts' labels: `mixed` when attempts that
 * observed receipts disagree, so a single broken attempt is not hidden.
 */
export const pooledReceipts = (rows) => {
  const seen = new Set(
    rows
      .map((row) => row?.receipts)
      .filter((label) => label === "available" || label === "unavailable")
  )
  if (seen.size === 0) return "unobserved"
  return seen.size === 1 ? [...seen][0] : "mixed"
}

/** Refusal codes summed over attempts, for the report's summary. */
export const summarizeRefusals = (attempts) => {
  const completion = {}
  const resolution = {}
  let attemptsRefused = 0
  let untraced = 0
  for (const row of attempts) {
    const refusals = sanitizeRefusals(row.refusals)
    if (!refusals) continue
    const refused = total(refusals.completion) + total(refusals.resolution)
    if (refused === 0) continue
    attemptsRefused += 1
    if (!refusals.traced) untraced += 1
    for (const [group, into] of [
      [refusals.completion, completion],
      [refusals.resolution, resolution]
    ])
      for (const [code, n] of Object.entries(group))
        into[code] = (into[code] ?? 0) + n
  }
  const sorted = (group) =>
    Object.fromEntries(
      Object.entries(group).sort(
        ([a, x], [b, y]) => y - x || a.localeCompare(b)
      )
    )
  return {
    attemptsRefused,
    untraced,
    completion: sorted(completion),
    resolution: sorted(resolution)
  }
}
