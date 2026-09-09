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
}

export interface AgentBenchmarkReport {
  measuredAt: string
  backend: string
  attempts: AgentAttemptRecord[]
  families: {
    family: string
    attempts: number
    completed: number
    medianWallMs: number
    repeatedTargets: number
    ambiguousTargets: number
  }[]
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

export const summarizeAttempts = (
  attempts: AgentAttemptRecord[]
): AgentBenchmarkReport["families"] => {
  const families = new Map<string, AgentAttemptRecord[]>()
  for (const attempt of attempts) {
    families.set(attempt.family, [
      ...(families.get(attempt.family) ?? []),
      attempt
    ])
  }
  return [...families.entries()]
    .map(([family, records]) => ({
      family,
      attempts: records.length,
      completed: records.filter(
        (record) => record.terminalStatus === "completed"
      ).length,
      medianWallMs: median(records.map((record) => record.wallMs)),
      repeatedTargets: records.reduce(
        (total, record) => total + record.repeatedTargets,
        0
      ),
      ambiguousTargets: records.reduce(
        (total, record) => total + record.ambiguousTargets,
        0
      )
    }))
    .sort((left, right) => left.family.localeCompare(right.family))
}

/**
 * Counts only, and no rate. One pass of a handful of attempts cannot support
 * a success rate, and publishing one from this would be the claim the audit
 * refused to make.
 */
/**
 * One attempt per family and scenario. Playwright retries a failed test, and
 * a module-level list would then hold the abandoned attempt as well as the
 * one that finished — so a later record for the same scenario replaces the
 * earlier one rather than joining it.
 */
export const recordAttempt = (
  attempts: AgentAttemptRecord[],
  attempt: AgentAttemptRecord
): void => {
  const existing = attempts.findIndex(
    (candidate) =>
      candidate.family === attempt.family &&
      candidate.scenario === attempt.scenario
  )
  if (existing >= 0) attempts.splice(existing, 1, attempt)
  else attempts.push(attempt)
}

export const writeAgentBenchmarkReport = (
  attempts: AgentAttemptRecord[],
  backend: string
): string => {
  const report: AgentBenchmarkReport = {
    measuredAt: new Date().toISOString(),
    backend,
    attempts,
    families: summarizeAttempts(attempts)
  }
  const directory = resolve("artifacts/e2e/benchmark")
  mkdirSync(directory, { recursive: true })
  const path = resolve(directory, `agent-benchmark-${Date.now()}.json`)
  writeFileSync(path, JSON.stringify(report, null, 2))
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
