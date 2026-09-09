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
  /** Verified steps whose command and target repeat an earlier verified step. */
  duplicateEffects: number
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
    duplicateEffects: number
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
 * A repeated effect is the failure this whole series exists to prevent, so it
 * is counted rather than inferred: two verified steps with the same command
 * type on the same target are one click that became two.
 */
export const countDuplicateEffects = (
  steps: {
    status: string
    command?: { type: string }
    target?: { ref?: string; tag?: string; name?: string }
  }[]
): number => {
  const seen = new Set<string>()
  let duplicates = 0
  for (const step of steps) {
    if (step.status !== "verified" || !step.command) continue
    const key = JSON.stringify([
      step.command.type,
      step.target?.tag,
      step.target?.name
    ])
    if (seen.has(key)) duplicates += 1
    else seen.add(key)
  }
  return duplicates
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
      duplicateEffects: records.reduce(
        (total, record) => total + record.duplicateEffects,
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
