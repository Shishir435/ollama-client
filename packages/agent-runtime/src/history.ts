import type {
  AgentHistoryEntry,
  AgentStepReadout,
  AgentStepTarget,
  AgentVerificationResult,
  ResolvedAgentTarget
} from "./ports"

/**
 * What the run has already done, as the model is allowed to read it.
 *
 * Every decision was previously made from the current page alone, so a run
 * that had just filled a field saw a filled field and no reason it was filled.
 * That is the loop the fixtures kept reproducing.
 *
 * Two rules make the record safe to act on. Outcome is derived from the
 * verification, never from the fact that a step was attempted: `executed`
 * without a confirmation is reported as unverified, because a step the run
 * cannot vouch for must not read as done. And the record is bounded twice —
 * by steps and by bytes — dropping oldest first, so a long run cannot grow
 * its own prompt until the observation stops fitting.
 */
export const AGENT_HISTORY_MAX_STEPS = 12
export const AGENT_HISTORY_MAX_BYTES = 6_000

/**
 * Counted rather than encoded: this package has no DOM and no Node globals,
 * and the bound has to mean bytes on the wire rather than UTF-16 units.
 */
const utf8Length = (value: string): number => {
  let bytes = 0
  for (let index = 0; index < value.length; index += 1) {
    const code = value.codePointAt(index) as number
    if (code > 0xffff) index += 1
    bytes += code < 0x80 ? 1 : code < 0x800 ? 2 : code < 0x10000 ? 3 : 4
  }
  return bytes
}

const outcomeOf = (step: AgentStepReadout): AgentHistoryEntry["outcome"] => {
  if (step.status === "rejected") return "rejected"
  if (step.status === "failed") return "failed"
  if (step.status === "uncertain") return "uncertain"
  if (step.status !== "verified") return "planned"
  const verified = step.verification?.outcome
  if (verified === "confirmed") return "confirmed"
  return verified === "negative" ? "failed" : "uncertain"
}

/** The command in words, without the grounding tokens that mean nothing later. */
const actionOf = (step: AgentStepReadout): string => {
  const command = step.command
  if (!command) return "decide"
  if (command.type === "navigate" || command.type === "open_tab") {
    return `${command.type} to ${command.url}`
  }
  if (command.type === "press_key") return `press ${command.key}`
  if (command.type === "scroll") return `scroll ${command.direction}`
  return command.type
}

/**
 * One entry per step, keyed by the step's own id rather than by receipt: a
 * step is appended several times as it moves through its lifecycle, and the
 * run wants the last thing known about it, not five copies of it.
 */
const latestByStep = (
  steps: readonly AgentStepReadout[]
): AgentStepReadout[] => {
  const latest = new Map<string, AgentStepReadout>()
  for (const step of [...steps].sort((a, b) => a.sequence - b.sequence)) {
    const existing = latest.get(step.stepId)
    latest.set(
      step.stepId,
      existing
        ? {
            ...existing,
            ...step,
            /** A later receipt without a command keeps the one that had it. */
            command: step.command ?? existing.command,
            target: step.target ?? existing.target,
            sourceUrl: step.sourceUrl ?? existing.sourceUrl,
            finding: step.finding ?? existing.finding,
            verification: step.verification ?? existing.verification
          }
        : step
    )
  }
  return [...latest.values()].sort((a, b) => a.sequence - b.sequence)
}

const entryOf = (step: AgentStepReadout, index: number): AgentHistoryEntry => ({
  step: index + 1,
  action: actionOf(step),
  outcome: outcomeOf(step),
  ...(step.target ? { target: step.target } : {}),
  ...(step.sourceUrl ? { url: step.sourceUrl } : {}),
  ...(step.verification?.evidence.summary
    ? { evidence: step.verification.evidence.summary }
    : {}),
  ...(step.finding ? { finding: step.finding } : {})
})

export const buildAgentHistory = (
  steps: readonly AgentStepReadout[],
  limits: { maxSteps?: number; maxBytes?: number } = {}
): AgentHistoryEntry[] => {
  const maxSteps = limits.maxSteps ?? AGENT_HISTORY_MAX_STEPS
  const maxBytes = limits.maxBytes ?? AGENT_HISTORY_MAX_BYTES
  const entries = latestByStep(steps).map(entryOf)
  const kept = entries.slice(Math.max(0, entries.length - maxSteps))
  /**
   * Dropped oldest first and one at a time, so the same run always produces
   * the same record: a truncation that depended on iteration order would make
   * two identical states look like different ones to the model.
   */
  while (kept.length > 1 && utf8Length(JSON.stringify(kept)) > maxBytes) {
    kept.shift()
  }
  return kept
}

/** The outcome of the step before this decision, or nothing on the first one. */
export const previousAgentVerification = (
  steps: readonly AgentStepReadout[]
): AgentVerificationResult | undefined => {
  const settled = latestByStep(steps).filter((step) => step.verification)
  return settled.at(-1)?.verification
}

/**
 * The record's view of what an effect acted on.
 *
 * A sensitive control keeps its role and tag and loses its name: the name of
 * a password or one-time-code field is page text about a secret, and history
 * is read back into a prompt. The command's own value is already redacted
 * where the receipt is written; this is the same rule for the label.
 */
export const agentStepTargetFrom = (
  target: ResolvedAgentTarget
): AgentStepTarget | undefined => {
  const entry: AgentStepTarget = {
    ...(target.ref ? { ref: target.ref } : {}),
    ...(target.tag ? { tag: target.tag } : {}),
    ...(target.role ? { role: target.role } : {}),
    ...(target.sensitive || !target.accessibleName
      ? {}
      : { name: target.accessibleName.slice(0, 120) })
  }
  return Object.keys(entry).length > 0 ? entry : undefined
}
