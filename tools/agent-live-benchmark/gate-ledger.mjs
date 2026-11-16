/**
 * Which runtime gate refused an attempt, when, and whether the evidence
 * proves the refusal wrong. A refusal histogram (`run-trace.mjs`) says how
 * often each code fired; this ledger lines every refusal up against the
 * oracle's judgment of the final page (`row.success`), so a gate change can
 * be judged by how many correct pages it refused, across every recorded run.
 *
 * Content-free like `run-trace.mjs`: only the fixed vocabularies below,
 * ordinals and counts leave this module. The panel text read to recognise an
 * unanswered permission prompt is matched, never copied.
 */
import {
  agentTraces,
  COMPLETION_REASONS,
  RESOLUTION_PHASES
} from "./run-trace.mjs"

const UNCLASSIFIED = "unclassified"

/**
 * The gates the ledger names. `completion_review` is the completion judge
 * (its `reason` keeps the judge's own code); the others refuse a command
 * before it runs, and `unretained_sighting` also refuses a completion.
 */
export const GATES = Object.freeze([
  "completion_review",
  ...new Set(Object.values(RESOLUTION_PHASES)),
  UNCLASSIFIED
])

/** Labels for a completion refusal; see `completionLabel`. */
export const COMPLETION_LABELS = Object.freeze([
  "false",
  "justified",
  "unknown"
])

/** The attempt outcome a command refusal sits in; see `commandOutcome`. */
export const COMMAND_OUTCOMES = Object.freeze([
  "achieved_run",
  "page_correct_run_not_achieved",
  "page_wrong_run",
  "page_unjudged"
])

/** Trace phases that mean a review or recovery budget ran out. */
export const BUDGET_CODES = Object.freeze([
  "completion_review_budget_exhausted",
  "read_prerequisite_review_budget_exhausted",
  "recovery_exhausted"
])

/** Verdicts where the run itself settled the task correctly. */
const SETTLED_VERDICTS = new Set(["achieved", "safely_handed_off"])

/**
 * Commands that only look: they send no input to the page and load no
 * document, so nothing the oracle judges (server effects, pages served,
 * the final address, field values) can change because one ran.
 */
const OBSERVING_ACTIONS = new Set([
  "read",
  "inspect",
  "find",
  "extract_text",
  "extract",
  "look",
  "zoom",
  "wait"
])

/**
 * Commands that move between documents without acting on one. The runtime
 * does not count navigation as a page change either (`agentEffectChangesPage`
 * in `packages/agent-runtime/src/completion.ts`): going somewhere is how a
 * run reads.
 */
const MOVING_ACTIONS = new Set([
  "navigate",
  "back",
  "forward",
  "open_tab",
  "switch_tab",
  "scroll",
  "hover"
])

/** Commands that press something; see `presses`. */
const PRESSING_ACTIONS = new Set(["click", "double_click", "click_point"])

/**
 * Two rules, because the two questions differ.
 *
 * `mayAlterJudgedState` (for the false/justified labels): an `executing`
 * trace line for any command that is not purely observing. `executing` is
 * logged before the effect port acts, so a command that threw half-way still
 * counts; navigation counts too, because the oracle also judges which pages
 * were served and where the run ended. A missing or unknown action counts.
 *
 * Changed the page (for breaking a refusal streak): an `executed` line, so
 * the command returned, whose input was not reported `undelivered`, for a
 * command that writes to the page (neither observing, moving nor pressing),
 * or for a press after which the next observation is the same document. A
 * press that loaded another document followed a link: the trace cannot tell
 * a link from a submit button (both verify as `activation`), and a run
 * reading its way through links is not making progress on a refused change.
 * A submit that loads a new document is therefore missed, which can only
 * lengthen a streak, never shorten one.
 *
 * Both read only the command type, delivery code and document id the
 * background effect trace and observation trace log
 * (`src/background/agent/agent-run-controller.ts`); the runtime's semantic
 * effect classes are not in the trace.
 */
const mayAlterJudgedState = (trace) =>
  trace.phase === "executing" && !OBSERVING_ACTIONS.has(trace.action)
const delivered = (trace) =>
  trace.phase === "executed" && trace.inputDelivery !== "undelivered"
const writesPage = (trace) =>
  delivered(trace) &&
  !OBSERVING_ACTIONS.has(trace.action) &&
  !MOVING_ACTIONS.has(trace.action) &&
  !PRESSING_ACTIONS.has(trace.action)
const presses = (trace) =>
  delivered(trace) && PRESSING_ACTIONS.has(trace.action)

const completionReason = (reason) =>
  COMPLETION_REASONS.includes(reason) ? reason : UNCLASSIFIED

const isRefusedCompletionRecovery = (trace) =>
  (trace.phase === "recovery_started" ||
    trace.phase === "recovery_exhausted") &&
  trace.trigger === "refused_completion"

/**
 * Every refusal in trace order, with the budget events beside it.
 *
 * A refused completion leaves exactly one of three lines: `completion_refused`
 * with its reason; or, when the refusal also hit the no-progress limit,
 * `recovery_started` or `recovery_exhausted` with trigger
 * `refused_completion` and no `completion_refused` at all. The same recovery
 * lines also follow a `completion_refused` at the refusal limit, where they
 * are that refusal's consequence, not a second refusal. Every refusal answers
 * a `decision` line, so a refused-completion recovery is a refusal of its own
 * only when nothing was refused since the last decision. Its reason is logged
 * by newer runtimes; for older traces it comes from the
 * `completion_settled_*` line that can follow it, else it is `unclassified`.
 *
 * A refused command leaves its gate's `*_refused` line, then
 * `command_refused`; a `command_refused` with none before it is
 * `unclassified`. `unretained_sighting_refused` with command `complete` is a
 * refused completion and is followed by no `command_refused`.
 */
const readLedger = (traces) => {
  const refusals = []
  const budgets = []
  let step = 0
  let pending
  let refusedThisDecision = false
  let changedSinceRefusal = false
  /** The document last observed, and the one a press left, until the next look. */
  let seenDocument
  let pressedOn
  const refuse = (index, kind, gate, reason) => {
    refusals.push({
      index,
      kind,
      gate,
      ...(reason === undefined ? {} : { reason }),
      step,
      afterChange: changedSinceRefusal
    })
    changedSinceRefusal = false
    refusedThisDecision = true
  }
  const lastCommandGate = () =>
    refusals.findLast((entry) => entry.kind === "command")?.gate
  traces.forEach((trace, index) => {
    const { phase } = trace
    if (phase === "decision") {
      if (pending) refuse(index, "command", pending)
      pending = undefined
      step += 1
      refusedThisDecision = false
    } else if (writesPage(trace)) changedSinceRefusal = true
    else if (presses(trace)) pressedOn = seenDocument ?? null
    else if (phase === "observed") {
      if (pressedOn !== undefined && trace.documentId === pressedOn)
        changedSinceRefusal = true
      pressedOn = undefined
      seenDocument = trace.documentId
    } else if (phase === "completion_refused")
      refuse(
        index,
        "completion",
        "completion_review",
        completionReason(trace.reason)
      )
    else if (
      phase === "unretained_sighting_refused" &&
      trace.command === "complete"
    )
      refuse(index, "completion", "unretained_sighting")
    else if (Object.hasOwn(RESOLUTION_PHASES, phase))
      pending = RESOLUTION_PHASES[phase]
    else if (phase === "command_refused") {
      refuse(index, "command", pending ?? UNCLASSIFIED)
      pending = undefined
    } else if (
      (phase === "completion_settled_proven" ||
        phase === "completion_settled_partial") &&
      COMPLETION_REASONS.includes(trace.reason)
    ) {
      const last = refusals.at(-1)
      if (
        last?.gate === "completion_review" &&
        last.reason === UNCLASSIFIED &&
        last.step === step
      )
        last.reason = trace.reason
    }
    if (isRefusedCompletionRecovery(trace) && !refusedThisDecision)
      refuse(
        index,
        "completion",
        "completion_review",
        completionReason(trace.reason)
      )
    if (phase === "completion_review_budget_exhausted")
      budgets.push({ index, code: phase, gate: "completion_review", step })
    else if (phase === "read_prerequisite_review_budget_exhausted")
      budgets.push({ index, code: phase, gate: "read_prerequisite", step })
    else if (phase === "recovery_exhausted") {
      const gate =
        trace.trigger === "refused_completion"
          ? "completion_review"
          : trace.trigger === "refused_commands"
            ? lastCommandGate()
            : undefined
      budgets.push({
        index,
        code: phase,
        ...(gate ? { gate } : {}),
        refusal:
          trace.trigger === "refused_completion" ||
          trace.trigger === "refused_commands",
        step
      })
    }
  })
  if (pending) refuse(traces.length, "command", pending)
  return { refusals, budgets, steps: step }
}

/**
 * How long after a command a page may still be changing by itself. A page
 * can finish its update with no further command (the `delayed` fixture
 * rewrites itself 1.2 s after the click, `late_controls` after 2 s), so a
 * completion refused inside this window may have been refused on a page that
 * was still wrong and only later became the one the oracle passes. The trace
 * does not record the page at the refusal, so such a refusal is `unknown`.
 * The window is a bound on the fixtures' own delays, not on real sites.
 */
const PAGE_SETTLE_MS = 5_000

/**
 * Whether a refusal came too soon after the last command that could alter
 * the page for the page to be taken as settled. Without both times it is
 * unknown, so it counts as settling.
 */
const stillSettling = (traces, index) => {
  const altered = traces.findLastIndex(
    (trace, at) => at < index && mayAlterJudgedState(trace)
  )
  if (altered < 0) return false
  const elapsed = traces[index]?.at - traces[altered].at
  return !(elapsed >= PAGE_SETTLE_MS)
}

/**
 * A completion refusal against the oracle. `false`: the final page is right
 * and nothing that could alter what the oracle judges ran after the refusal,
 * so the state the gate refused was already the right one. `justified`: the
 * final page is wrong and nothing ran after, so the refused state was wrong.
 * `unknown`: something ran after, the oracle gave no judgment, or the page
 * may not have settled yet (see `PAGE_SETTLE_MS`).
 *
 * What `false` does not prove: that the run's claim was worded right. Where
 * the oracle also scores the reply (a code, a price), the reply was written
 * after the refusal; it rests on the same page, but its words are not in the
 * trace.
 */
const completionLabel = (success, alteredAfter, settling) => {
  if (alteredAfter || settling || typeof success !== "boolean") return "unknown"
  return success ? "false" : "justified"
}

/**
 * A command refusal cannot be labelled: the page at that moment is not
 * recoverable, and whether the command was needed is not provable. The
 * outcome of the attempt it sits in is recorded instead.
 */
const commandOutcome = (row) => {
  if (SETTLED_VERDICTS.has(row?.verdict)) return "achieved_run"
  if (row?.success === true) return "page_correct_run_not_achieved"
  if (row?.success === false) return "page_wrong_run"
  return "page_unjudged"
}

const sameReason = (a, b) => a.reason === b.reason && a.reason !== UNCLASSIFIED

/**
 * The longest run of consecutive refusals per gate: same gate, same reason
 * (an unclassified reason matches nothing), and no command that changed the
 * page between them. Other gates' refusals in between end a run.
 */
const longestStreaks = (refusals) => {
  const longest = {}
  let run = 0
  refusals.forEach((entry, index) => {
    const previous = refusals[index - 1]
    run =
      previous &&
      previous.gate === entry.gate &&
      sameReason(previous, entry) &&
      !entry.afterChange
        ? run + 1
        : 1
    longest[entry.gate] = Math.max(longest[entry.gate] ?? 0, run)
  })
  return longest
}

/**
 * The refusal ledger for one attempt, its last refusal when the run did not
 * settle, the budgets it exhausted and its longest repeat per gate. `row`
 * supplies the oracle (`success`) and the verdict; `evidence` the trace.
 */
export const gateLedger = (row, evidence) => {
  const traces = agentTraces(evidence?.logs)
  const { refusals, budgets, steps } = readLedger(traces)
  let lastAlter = -1
  traces.forEach((trace, index) => {
    if (mayAlterJudgedState(trace)) lastAlter = index
  })
  const outcome = commandOutcome(row)
  const ledger = refusals.map((entry) => ({
    kind: entry.kind,
    gate: entry.gate,
    ...(entry.reason === undefined ? {} : { reason: entry.reason }),
    step: entry.step,
    afterChange: entry.afterChange,
    ...(entry.kind === "completion"
      ? {
          label: completionLabel(
            row?.success,
            lastAlter > entry.index,
            stillSettling(traces, entry.index)
          )
        }
      : { outcome })
  }))
  const lastDecision = traces.findLastIndex(
    (trace) => trace.phase === "decision"
  )
  const last = refusals.at(-1)
  const lastExecuted = traces.findLastIndex(
    (trace) => trace.phase === "executed"
  )
  /** The decision the last refusal answered, through the end of the run. */
  const terminalFrom = last
    ? traces.findLastIndex(
        (trace, index) => trace.phase === "decision" && index < last.index
      )
    : -1
  const terminal =
    last && !SETTLED_VERDICTS.has(row?.verdict)
      ? {
          gate: last.gate,
          ...(last.reason === undefined ? {} : { reason: last.reason }),
          exhausted: [
            ...new Set(
              budgets
                .filter((budget) => budget.index > terminalFrom)
                .map((budget) => budget.code)
            )
          ]
        }
      : undefined
  return {
    traced: traces.length > 0,
    steps,
    refusals: ledger,
    budgets: budgets.map(({ code, gate, step }) => ({
      code,
      ...(gate ? { gate } : {}),
      step
    })),
    ...(terminal ? { terminal } : {}),
    streaks: longestStreaks(refusals),
    /** For the stop cause: what ran out after the run's last decision. */
    endBudgets: budgets
      .filter((budget) => budget.index > lastDecision)
      .map(({ code, refusal }) =>
        code === "recovery_exhausted" && refusal ? "refusal_recovery" : code
      ),
    /** For the stop cause: the run's last refusal came after its last command. */
    refusedLast: Boolean(last && last.index > lastExecuted)
  }
}

/**
 * Why an attempt that did not settle stopped. Fixed vocabulary; a cause none
 * of these rules recognises is `unclassified`, so a new one shows up as a
 * growing count rather than as a wrong label.
 */
export const STOP_CAUSES = Object.freeze([
  "permission_prompt_unanswered",
  "not_started",
  "cost_cap_reached",
  "provider_failure",
  "model_stalled",
  "harness_timeout",
  "harness_error",
  "site_blocked",
  "run_completed",
  "answered_in_chat",
  "unresolved_effect",
  "run_budget_exhausted",
  "invalid_decision",
  "interrupted",
  "read_prerequisite_review_budget_exhausted",
  "completion_review_budget_exhausted",
  "refusal_recovery_exhausted",
  "recovery_exhausted",
  "gate_refusal",
  "model_ended_run",
  UNCLASSIFIED
])

/** Causes whose gate is the attempt's terminal gate. */
const GATED_CAUSES = new Set([
  "read_prerequisite_review_budget_exhausted",
  "completion_review_budget_exhausted",
  "refusal_recovery_exhausted",
  "gate_refusal"
])

/**
 * The sentences of the two cards that hold a request until someone answers
 * them: an optional browser permission (`chat.permissions.enable_description`)
 * and the browser agent being off (`chat.permissions.agent.description`).
 * English only, from `src/locales/en/translation.json`: the harness drives
 * the panel in English (see `CHAT_LABELS` in `chat-turn.mjs`), and a test
 * holds these to the locale file.
 */
export const PERMISSION_PROMPT_SENTENCES = Object.freeze([
  "Enable it to continue this request. Access remains optional and revocable.",
  "This looks like a task in the browser. The agent is experimental and works best with hosted models."
])

/**
 * Whether the attempt sat on a permission prompt nobody answered. Nothing
 * structural records it: the card is a chat message, and the evidence keeps
 * neither chat messages nor the card's capability id, so the panel text is
 * matched. Required alongside: no agent run started in this attempt (no
 * trace, no snapshot of a run created since the attempt began). An answered
 * prompt starts the run, and a card left over from an earlier turn cannot
 * explain an attempt whose run went ahead.
 */
export const unansweredPermissionPrompt = (evidence) => {
  const text = typeof evidence?.panelText === "string" ? evidence.panelText : ""
  if (!PERMISSION_PROMPT_SENTENCES.some((sentence) => text.includes(sentence)))
    return false
  if (agentTraces(evidence?.logs).length > 0) return false
  const since = evidence?.timing?.started
  return !(Array.isArray(evidence?.messages) ? evidence.messages : []).some(
    (message) =>
      message?.snapshot?.run &&
      (!Number.isFinite(since) ||
        (message.snapshot.run.createdAt ?? 0) >= since)
  )
}

const PROVIDER_FAILURE_CODES = new Set([
  "provider_unavailable",
  "provider_refused",
  "provider_rate_limited"
])
const COMPLETED_STATUSES = new Set(["completed", "completed_unverified"])
const INTERRUPTING_PAUSES = new Set([
  "user",
  "panel_closed",
  "browser_disconnected",
  "takeover"
])

/**
 * The stop cause of an attempt, from its row (as classified) and the ledger.
 * Undefined for an attempt the run settled. The order is the order of
 * precedence: a harness or provider fault explains the stop before anything
 * the run did, then how the run itself ended, then the trace.
 *
 * `model_stalled` here means the model was called and then went silent; a
 * row the harness marked stalled with no model call at all is not that, and
 * is `unclassified` unless a prompt explains it.
 */
export const stopCause = (row, evidence, gates) => {
  if (!row || SETTLED_VERDICTS.has(row.verdict)) return undefined
  if (unansweredPermissionPrompt(evidence))
    return "permission_prompt_unanswered"
  if (row.failureCode === "cost_cap_reached") return "cost_cap_reached"
  if (
    row.verdict === "provider_failure" ||
    PROVIDER_FAILURE_CODES.has(row.failureCode)
  )
    return "provider_failure"
  if (row.verdict === "admission_failure") return "not_started"
  if (row.failureCode === "model_stalled")
    return row.modelCalls > 0 ? "model_stalled" : UNCLASSIFIED
  if (
    row.harnessTimedOut === true ||
    /^harness_(?:\w+_)?timeout$/.test(row.failureCode ?? "")
  )
    return "harness_timeout"
  if (row.verdict === "infrastructure_failure") return "harness_error"
  if (row.verdict === "site_blockage") return "site_blocked"
  if (COMPLETED_STATUSES.has(row.status)) return "run_completed"
  if (row.status === "answered_in_chat") return "answered_in_chat"
  if (row.pauseReason === "unresolved_effect") return "unresolved_effect"
  if (row.errorCode === "budget_exhausted") return "run_budget_exhausted"
  if (row.errorCode === "invalid_decision") return "invalid_decision"
  if (row.status === "cancelled" || INTERRUPTING_PAUSES.has(row.pauseReason))
    return "interrupted"
  if (!gates?.traced) return UNCLASSIFIED
  const ended = gates.endBudgets ?? []
  for (const code of [
    "read_prerequisite_review_budget_exhausted",
    "completion_review_budget_exhausted"
  ])
    if (ended.includes(code)) return code
  if (ended.includes("refusal_recovery")) return "refusal_recovery_exhausted"
  if (ended.includes("recovery_exhausted")) return "recovery_exhausted"
  if (gates.refusedLast) return "gate_refusal"
  return "model_ended_run"
}

/**
 * The fields both live runners and `rescore` add to a row: the gate ledger,
 * and for an attempt that did not settle, its stop cause (with the gate,
 * when the cause is one).
 */
export const gateTelemetry = (row, evidence) => {
  const gates = gateLedger(row, evidence)
  const cause = stopCause(row, evidence, gates)
  const { endBudgets: _ended, refusedLast: _refusedLast, ...kept } = gates
  return {
    gates: kept,
    ...(cause
      ? {
          stopCause: cause,
          ...(GATED_CAUSES.has(cause) && gates.terminal
            ? { stopGate: gates.terminal.gate }
            : {})
        }
      : {})
  }
}

const count = (value) =>
  Number.isInteger(value) && value >= 0 && value <= 1_000_000 ? value : 0
const oneOf = (allowed, value) => (allowed.includes(value) ? value : undefined)
const REASONS = [...COMPLETION_REASONS, UNCLASSIFIED]

/**
 * A ledger reduced to the fixed vocabulary, for the shareable baseline: an
 * unexpected key or value is dropped, so nothing in it can carry text.
 */
export const sanitizeGates = (value) => {
  if (!value || typeof value !== "object") return undefined
  const gate = (code) => oneOf(GATES, code)
  const reason = (code) => oneOf(REASONS, code)
  const refusals = (Array.isArray(value.refusals) ? value.refusals : [])
    .filter(
      (entry) =>
        ["completion", "command"].includes(entry?.kind) && gate(entry.gate)
    )
    .map((entry) => ({
      kind: entry.kind,
      gate: entry.gate,
      ...(reason(entry.reason) ? { reason: entry.reason } : {}),
      step: count(entry.step),
      afterChange: entry.afterChange === true,
      ...(entry.kind === "completion"
        ? { label: oneOf(COMPLETION_LABELS, entry.label) ?? "unknown" }
        : {
            outcome: oneOf(COMMAND_OUTCOMES, entry.outcome) ?? "page_unjudged"
          })
    }))
  const budgets = (Array.isArray(value.budgets) ? value.budgets : [])
    .filter((entry) => oneOf(BUDGET_CODES, entry?.code))
    .map((entry) => ({
      code: entry.code,
      ...(gate(entry.gate) ? { gate: entry.gate } : {}),
      step: count(entry.step)
    }))
  const terminal =
    value.terminal && gate(value.terminal.gate)
      ? {
          gate: value.terminal.gate,
          ...(reason(value.terminal.reason)
            ? { reason: value.terminal.reason }
            : {}),
          exhausted: (Array.isArray(value.terminal.exhausted)
            ? value.terminal.exhausted
            : []
          ).filter((code) => BUDGET_CODES.includes(code))
        }
      : undefined
  return {
    traced: value.traced === true,
    steps: count(value.steps),
    refusals,
    budgets,
    ...(terminal ? { terminal } : {}),
    streaks: Object.fromEntries(
      GATES.filter((code) => count(value.streaks?.[code]) > 0).map((code) => [
        code,
        count(value.streaks[code])
      ])
    )
  }
}

const emptyRow = () => ({
  refusals: 0,
  ...Object.fromEntries(COMPLETION_LABELS.map((label) => [label, 0])),
  ...Object.fromEntries(COMMAND_OUTCOMES.map((outcome) => [outcome, 0])),
  terminal: 0,
  budgetExhausted: 0,
  longestStreak: 0
})

/**
 * The per-gate table over every attempt: refusals; completion refusals by
 * label; command refusals by the outcome of their attempt; how often the gate
 * was the terminal one; budgets it exhausted; its longest repeat in any one
 * attempt. `untraced` counts attempts whose receipts show refusals but which
 * have no trace to place them; they are not in the table.
 */
export const summarizeGates = (attempts) => {
  const table = {}
  const at = (code) => (table[code] ??= emptyRow())
  let traced = 0
  let untraced = 0
  const budgets = {}
  for (const row of attempts) {
    const gates = sanitizeGates(row.gates)
    const receiptRefusals =
      count(row.refusals?.rejectedSteps?.completion) +
      count(row.refusals?.rejectedSteps?.resolution)
    if (!gates?.traced) {
      if (receiptRefusals > 0) untraced += 1
      continue
    }
    traced += 1
    for (const entry of gates.refusals) {
      const into = at(entry.gate)
      into.refusals += 1
      into[entry.kind === "completion" ? entry.label : entry.outcome] += 1
    }
    if (gates.terminal) at(gates.terminal.gate).terminal += 1
    for (const budget of gates.budgets) {
      budgets[budget.code] = (budgets[budget.code] ?? 0) + 1
      if (budget.gate) at(budget.gate).budgetExhausted += 1
    }
    for (const [code, length] of Object.entries(gates.streaks))
      at(code).longestStreak = Math.max(at(code).longestStreak, length)
  }
  return {
    tracedAttempts: traced,
    untracedAttempts: untraced,
    table: Object.fromEntries(
      GATES.filter((code) => table[code]).map((code) => [code, table[code]])
    ),
    budgets: Object.fromEntries(
      BUDGET_CODES.filter((code) => budgets[code]).map((code) => [
        code,
        budgets[code]
      ])
    )
  }
}

/** Stop causes over the attempts that did not settle, most frequent first. */
export const summarizeStopCauses = (attempts) => {
  const counts = new Map()
  for (const row of attempts) {
    const cause = oneOf(STOP_CAUSES, row.stopCause)
    if (!cause) continue
    const gate = oneOf(GATES, row.stopGate)
    const key = gate ? `${cause}/${gate}` : cause
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  return [...counts]
    .map(([key, n]) => {
      const [cause, gate] = key.split("/")
      return { cause, ...(gate ? { gate } : {}), count: n }
    })
    .sort((a, b) => b.count - a.count || a.cause.localeCompare(b.cause))
}
