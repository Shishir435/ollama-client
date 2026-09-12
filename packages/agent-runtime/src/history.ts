import type {
  AgentFinding,
  AgentHistoryEntry,
  AgentInspectionFocus,
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
 * Per-field caps, so one entry can never be the reason the record breaks its
 * bound. Without them the byte loop had to keep a single entry it could not
 * fit, and forwarded it anyway.
 */
const MAX_ACTION_CHARS = 200
const MAX_EVIDENCE_CHARS = 200
const MAX_URL_CHARS = 300

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

/**
 * A page's identity, and nothing else the URL happens to carry.
 *
 * A controlled page's URL can hold credentials in its userinfo, a token in a
 * query parameter, or an access token in its fragment. History is durable and
 * is read back into a prompt, so keeping the whole URL would store a secret
 * and disclose it again after the run had left the page. Origin and path are
 * what distinguish one page from another; the rest is dropped.
 */
const HTTP_ORIGIN_AND_PATH = /^(https?):\/\/(?:[^/@]*@)?([^/?#]+)([^?#]*)/i

export const agentStepSourceUrl = (url: string): string | undefined => {
  /**
   * Read structurally rather than with `URL`: this package has no DOM, and
   * widening its lib to borrow one parser would open the whole surface it
   * exists to stay out of.
   */
  const match = HTTP_ORIGIN_AND_PATH.exec(url.trim())
  if (!match) return undefined
  const [, scheme, authority, path] = match
  return `${scheme.toLowerCase()}://${authority.toLowerCase()}${path}`.slice(
    0,
    MAX_URL_CHARS
  )
}

/** The command in words, without the grounding tokens that mean nothing later. */
const actionOf = (step: AgentStepReadout): string => {
  const command = step.command
  if (!command) return "decide"
  if (command.type === "navigate" || command.type === "open_tab") {
    const destination = agentStepSourceUrl(command.url) ?? "an unusable URL"
    return `${command.type} to ${destination}`
  }
  if (command.type === "press_key") return `press ${command.key}`
  if (command.type === "scroll") return `scroll ${command.direction}`
  if (command.type === "drag") return `drag onto ${command.to}`
  /**
   * The direction is the whole decision here: a run reading back
   * "handle_dialog" could not tell the confirmation it refused from the one
   * it gave, which is exactly the fact a later step needs.
   */
  if (command.type === "handle_dialog") {
    return command.accept ? "accept dialog" : "dismiss dialog"
  }
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

const entryOf = (step: AgentStepReadout, index: number): AgentHistoryEntry => {
  const url = step.sourceUrl ? agentStepSourceUrl(step.sourceUrl) : undefined
  return {
    step: index + 1,
    action: actionOf(step).slice(0, MAX_ACTION_CHARS),
    outcome: outcomeOf(step),
    ...(step.target ? { target: step.target } : {}),
    ...(url ? { url } : {}),
    ...(step.verification?.evidence.summary
      ? {
          evidence: step.verification.evidence.summary.slice(
            0,
            MAX_EVIDENCE_CHARS
          )
        }
      : {}),
    ...(step.finding ? { finding: step.finding } : {})
  }
}

/**
 * What survives when a single entry is still too large for the whole record:
 * the optional fields go in the order the model can most afford to lose.
 * Reaching this means the caller asked for a bound smaller than one entry.
 */
const OPTIONAL_ENTRY_FIELDS = ["finding", "evidence", "target", "url"] as const

const shrinkToBound = (
  entry: AgentHistoryEntry,
  maxBytes: number
): AgentHistoryEntry => {
  let reduced = entry
  for (const field of OPTIONAL_ENTRY_FIELDS) {
    if (utf8Length(JSON.stringify([reduced])) <= maxBytes) break
    const { [field]: _dropped, ...rest } = reduced
    reduced = rest
  }
  return reduced
}

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
  /** The bound is a bound: a lone entry that still exceeds it is reduced. */
  return kept.length === 1 ? [shrinkToBound(kept[0], maxBytes)] : kept
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

/**
 * The inspection the run's most recent step asked for, if it asked for one.
 * Read from that step's own durable command so a worker restart reconstructs
 * it exactly. A step that was anything else — a click, a navigation, a plain
 * read — clears the focus, so an overview returns unless the model inspects
 * again.
 */
export const currentAgentInspection = (
  steps: readonly AgentStepReadout[]
): AgentInspectionFocus | undefined => {
  const command = latestByStep(steps).at(-1)?.command
  if (!command) return undefined
  if (command.type === "inspect") return { region: command.target }
  if (command.type === "find") return { query: command.query }
  if (command.type === "extract_text")
    return {
      text: true,
      offset: command.offset ?? 0,
      frameId: command.frameId ?? 0
    }
  if (command.type === "zoom") {
    return {
      zoom: {
        x: command.x,
        y: command.y,
        width: command.width,
        height: command.height
      }
    }
  }
  return undefined
}

/**
 * The run's findings, oldest first, kept past the bound the history window
 * imposes so a fact learned on step 2 is still there on step 50. Each carries
 * the page it was recorded on, redacted the same way history's own source is,
 * so a claim can be weighed against the site that produced it. Bounded twice —
 * by count and by bytes, dropping the oldest — because the store is otherwise
 * unbounded across a long run.
 */
export const AGENT_FINDINGS_MAX = 24
export const AGENT_FINDINGS_MAX_BYTES = 4_000

export const buildAgentFindings = (
  steps: readonly AgentStepReadout[],
  limits: { max?: number; maxBytes?: number } = {}
): AgentFinding[] => {
  const collected: AgentFinding[] = []
  latestByStep(steps).forEach((step, index) => {
    if (!step.finding) return
    const source = step.sourceUrl
      ? agentStepSourceUrl(step.sourceUrl)
      : undefined
    collected.push({
      step: index + 1,
      note: step.finding,
      ...(source ? { source } : {})
    })
  })
  let kept = collected.slice(-(limits.max ?? AGENT_FINDINGS_MAX))
  const maxBytes = limits.maxBytes ?? AGENT_FINDINGS_MAX_BYTES
  while (kept.length > 1 && utf8Length(JSON.stringify(kept)) > maxBytes) {
    kept = kept.slice(1)
  }
  return kept
}
