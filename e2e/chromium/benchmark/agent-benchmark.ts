import { mkdirSync, writeFileSync } from "node:fs"
import { resolve } from "node:path"
import type { AgentPanelMessage } from "@ollama-client/contracts"

/**
 * The frozen record of one benchmark pass.
 *
 * The point of a benchmark is that a later run can be compared with an
 * earlier one, so what it records has to be the same every time and has to be
 * safe to keep. Every field here is a count, a label or a hash: no page text,
 * no entered text, no URL, nothing a fixture happened to render. A report
 * that carried page content could not be attached to an issue, which is the
 * only reason to write one.
 */
export interface AgentAttemptRecord {
  family: string
  scenario: string
  attempt: number
  backend: string
  terminalStatus: string
  /**
   * The status the task declares as its finish. Some tasks are meant to pause
   * — asking about a frame it may not read is the right answer — so a
   * completion is not the measure for every row, and counting one as missed
   * would score the correct outcome as a failure.
   */
  expectedStatus: string
  /** Why it stopped, when it stopped for a reason. */
  pauseReason?: string
  errorCode?: string
  steps: number
  observations: number
  modelCalls: number
  approvalsAsked: number
  approvalsGranted: number
  /**
   * Verified steps whose recorded identity repeats an earlier one. Not proof
   * of a repeated effect: a page with two identically named controls of the
   * same role produces the same identity for both, and a receipt does not
   * record enough to tell them apart.
   */
  repeatedTargets: number
  /** Verified steps whose identity another verified step also carries. */
  ambiguousTargets: number
  wallMs: number
  /** The first thing that stopped it going further, as a label. */
  firstLimitation?: string
  /**
   * Whether the goal was actually met, judged from the page by the task's own
   * predicate rather than from what the run reported. `undefined` for a task
   * that declares no predicate, which is not the same as false.
   */
  succeeded?: boolean
  /**
   * The run said it was done and the page says otherwise. The single number
   * the completion-evidence rule exists to move, and the reason `succeeded`
   * cannot be the run's own verdict.
   */
  falseCompletion?: boolean
  /** Tokens the provider reported; absent on a scripted fixture. */
  promptTokens?: number
  completionTokens?: number
}

export interface AgentFamilySummary {
  family: string
  backend: string
  attempts: number
  completed: number
  /** Attempts whose own predicate confirmed the goal. */
  succeeded: number
  /** Attempts that reported completion the page did not support. */
  falseCompletions: number
  /**
   * The other error, and the one a table showing only completions hides: the
   * goal was met and the run never said so. A run that over-claims, is
   * refused, and then burns its budget without noticing the page came good
   * lands here — a real failure, and not the same kind as claiming falsely.
   */
  missedCompletions: number
  medianWallMs: number
  repeatedTargets: number
  ambiguousTargets: number
  approvalsAsked: number
  /** Absent where nothing reported tokens. */
  medianPromptTokens?: number
  medianCompletionTokens?: number
}

export interface AgentBenchmarkReport {
  measuredAt: string
  backend: string
  model: string
  attempts: AgentAttemptRecord[]
  families: AgentFamilySummary[]
}

const median = (values: number[]): number => {
  if (values.length === 0) return 0
  const sorted = [...values].sort((left, right) => left - right)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0
    ? Math.round((sorted[middle - 1] + sorted[middle]) / 2)
    : sorted[middle]
}

/**
 * A repeated effect is the failure the whole series exists to prevent, so it
 * is measured — but measured for what a receipt can actually say.
 *
 * A receipt records the command, the target's role, tag and bounded name, and
 * the page. Two distinct controls can share all of that: the modal fixture
 * has a Delete inside the dialog and a Delete behind it. So a repeat here is
 * a repeated *identity*, and the count of identities more than one step
 * carries is reported beside it, so a number can be read as suspicion rather
 * than as proof. Distinguishing them needs the owning group in the receipt,
 * which the receipt does not yet carry.
 */
export const countRepeatedTargets = (
  steps: {
    status: string
    command?: { type: string }
    sourceUrl?: string
    target?: { ref?: string; tag?: string; role?: string; name?: string }
  }[]
): { repeated: number; ambiguous: number } => {
  const counts = new Map<string, number>()
  for (const step of steps) {
    if (step.status !== "verified" || !step.command) continue
    const key = JSON.stringify([
      step.command.type,
      step.target?.tag,
      step.target?.role,
      step.target?.name,
      step.sourceUrl
    ])
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  let repeated = 0
  let ambiguous = 0
  for (const count of counts.values()) {
    if (count <= 1) continue
    repeated += count - 1
    ambiguous += count
  }
  return { repeated, ambiguous }
}

const medianOf = (values: number[]): number | undefined =>
  values.length > 0 ? median(values) : undefined

/**
 * One row per family and backend, because the comparison is the point: the
 * same tasks on the native backend and on the DOM one, side by side, is what
 * turns "native input is better" into a number.
 */
export const summarizeAttempts = (
  attempts: AgentAttemptRecord[]
): AgentFamilySummary[] => {
  const groups = new Map<string, AgentAttemptRecord[]>()
  for (const attempt of attempts) {
    const key = `${attempt.family}\u0000${attempt.backend}`
    groups.set(key, [...(groups.get(key) ?? []), attempt])
  }
  return [...groups.values()]
    .map((records) => {
      const promptTokens = records
        .map((record) => record.promptTokens)
        .filter((value): value is number => value !== undefined)
      const completionTokens = records
        .map((record) => record.completionTokens)
        .filter((value): value is number => value !== undefined)
      const medianPrompt = medianOf(promptTokens)
      const medianCompletion = medianOf(completionTokens)
      return {
        family: records[0].family,
        backend: records[0].backend,
        attempts: records.length,
        completed: records.filter(
          (record) => record.terminalStatus === "completed"
        ).length,
        succeeded: records.filter((record) => record.succeeded === true).length,
        falseCompletions: records.filter(
          (record) => record.falseCompletion === true
        ).length,
        missedCompletions: records.filter(
          (record) =>
            record.succeeded === true &&
            record.expectedStatus === "completed" &&
            record.terminalStatus !== "completed"
        ).length,
        medianWallMs: median(records.map((record) => record.wallMs)),
        repeatedTargets: records.reduce(
          (total, record) => total + record.repeatedTargets,
          0
        ),
        ambiguousTargets: records.reduce(
          (total, record) => total + record.ambiguousTargets,
          0
        ),
        approvalsAsked: records.reduce(
          (total, record) => total + record.approvalsAsked,
          0
        ),
        ...(medianPrompt === undefined
          ? {}
          : { medianPromptTokens: medianPrompt }),
        ...(medianCompletion === undefined
          ? {}
          : { medianCompletionTokens: medianCompletion })
      }
    })
    .sort(
      (left, right) =>
        left.family.localeCompare(right.family) ||
        left.backend.localeCompare(right.backend)
    )
}

/**
 * One attempt per family, scenario and backend. Playwright retries a failed
 * test, and a module-level list would then hold the abandoned attempt as well
 * as the one that finished — so a later record for the same key replaces the
 * earlier one rather than joining it.
 */
export const recordAttempt = (
  attempts: AgentAttemptRecord[],
  attempt: AgentAttemptRecord
): void => {
  const existing = attempts.findIndex(
    (candidate) =>
      candidate.family === attempt.family &&
      candidate.scenario === attempt.scenario &&
      candidate.attempt === attempt.attempt &&
      candidate.backend === attempt.backend
  )
  if (existing >= 0) attempts.splice(existing, 1, attempt)
  else attempts.push(attempt)
}

/**
 * The report as a table a person reads.
 *
 * Counts and an explicit denominator, never a bare rate: a family run three
 * times cannot support a percentage, and printing one is the claim this whole
 * series refuses to make. `n` is in the table so a reader can see what the
 * number is worth.
 */
export const renderAgentBenchmarkMarkdown = (
  report: AgentBenchmarkReport
): string => {
  const lines = [
    `# Agent benchmark — ${report.backend}`,
    "",
    `Measured ${report.measuredAt} against \`${report.model}\`.`,
    "",
    "Counts, not rates. `n` is the attempts behind each row.",
    "",
    "| family | backend | n | completed | goal met | false completions | missed completions | approvals | repeated targets | median ms | median prompt tk | median output tk |",
    "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |"
  ]
  for (const family of report.families) {
    lines.push(
      `| ${family.family} | ${family.backend} | ${family.attempts} | ${family.completed} | ${family.succeeded} | ${family.falseCompletions} | ${family.missedCompletions} | ${family.approvalsAsked} | ${family.repeatedTargets} | ${family.medianWallMs} | ${family.medianPromptTokens ?? "—"} | ${family.medianCompletionTokens ?? "—"} |`
    )
  }
  const totals = report.families.reduce(
    (sum, family) => ({
      attempts: sum.attempts + family.attempts,
      completed: sum.completed + family.completed,
      succeeded: sum.succeeded + family.succeeded,
      falseCompletions: sum.falseCompletions + family.falseCompletions,
      missedCompletions: sum.missedCompletions + family.missedCompletions
    }),
    {
      attempts: 0,
      completed: 0,
      succeeded: 0,
      falseCompletions: 0,
      missedCompletions: 0
    }
  )
  lines.push(
    "",
    `Across every family: ${totals.completed} of ${totals.attempts} attempts reported completion and ${totals.succeeded} met the task's own predicate. ${totals.falseCompletions} reported a completion the page did not support; ${totals.missedCompletions} met the goal and never said so.`
  )
  return `${lines.join("\n")}\n`
}

export const writeAgentBenchmarkReport = (
  attempts: AgentAttemptRecord[],
  backend: string,
  model = backend
): string => {
  const report: AgentBenchmarkReport = {
    measuredAt: new Date().toISOString(),
    backend,
    model,
    attempts,
    families: summarizeAttempts(attempts)
  }
  const directory = resolve("artifacts/e2e/benchmark")
  mkdirSync(directory, { recursive: true })
  const stamp = Date.now()
  const path = resolve(directory, `agent-benchmark-${stamp}.json`)
  writeFileSync(path, JSON.stringify(report, null, 2))
  writeFileSync(
    resolve(directory, `agent-benchmark-${stamp}.md`),
    renderAgentBenchmarkMarkdown(report)
  )
  return path
}

export const approvalsAsked = (messages: AgentPanelMessage[]): string[] => [
  ...new Set(
    messages.flatMap((message) =>
      message.type === "agent_snapshot" &&
      message.snapshot.pending?.kind === "approval"
        ? [message.snapshot.pending.request.id]
        : []
    )
  )
]
