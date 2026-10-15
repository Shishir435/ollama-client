import {
  type AgentStepWrite,
  boundAgentEvidence,
  isAppliedAgentStepStatus
} from "@ollama-client/agent-runtime"
import {
  type AgentEvidenceRecord,
  type AgentRunState,
  agentRequirementTier,
  MAX_AGENT_FINDING_CHARS,
  MAX_AGENT_HANDOFF_ACTIONS,
  MAX_AGENT_HANDOFF_CONTROL_CHARS,
  MAX_AGENT_REQUIREMENT_CHARS,
  MAX_AGENT_SOURCE_QUOTE_CHARS
} from "@ollama-client/contracts"
import {
  AGENT_HANDOFF_STATUSES,
  type AgentConversationHandoff,
  AgentConversationHandoffSchema,
  MAX_AGENT_HANDOFF_FINDINGS,
  MAX_AGENT_HANDOFF_GOAL_CHARS,
  MAX_AGENT_HANDOFF_RESULT_CHARS
} from "@ollama-client/contracts/agent-handoff"
import { redactLogText } from "@/lib/log-redaction"

/**
 * Anything a later model could read as somewhere to go: an explicit scheme, a
 * scheme-relative `//host`, and a bare `host.tld` with or without a path.
 * Replaced rather than kept as text: a handoff tells a later turn what a run
 * found, never where to go next, and a link in page-derived text is the
 * shortest path from a hostile page to a second visit.
 *
 * The bare-host rule is deliberately greedy. It also takes `node.js` and
 * `README.md`, which costs a note a word; missing `evil.example/pay` costs a
 * user a visit.
 */
const LINK_PATTERNS = [
  /\b[a-z][a-z0-9+.-]*:\/\/\S*/gi,
  /\b(?:javascript|data|file|about|chrome|mailto|blob):\S*/gi,
  /(?<![\w:])\/\/[^\s/]+\S*/g,
  /\b(?:[a-z0-9-]+\.)+[a-z]{2,24}(?::\d{1,5})?(?:[/?#]\S*)?/gi
]

/** Punctuation ending the sentence a link sat in, kept outside the link. */
const TRAILING_PUNCTUATION = /[.,;:!?)\]'"]+$/

const withoutLinks = (value: string): string =>
  LINK_PATTERNS.reduce(
    (text, pattern) =>
      text.replaceAll(
        pattern,
        (link) => `[link]${link.match(TRAILING_PUNCTUATION)?.[0] ?? ""}`
      ),
    value
  )

/**
 * Page-derived or model-authored text, made safe to carry into a prompt.
 *
 * Control characters and line breaks are flattened, so a finding cannot draw
 * its own heading or fence; links are removed; anything shaped like a secret
 * is redacted the way a log line would be; and the result is bounded. The
 * fence itself is the context builder's job — this only guarantees that what
 * goes inside it is one plain line.
 */
export const handoffPlainText = (value: string, limit: number): string => {
  const flattened = Array.from(value, (character) => {
    const code = character.charCodeAt(0)
    return code < 32 || code === 127 ? " " : character
  }).join("")
  const cleaned = redactLogText(withoutLinks(flattened))
    .replaceAll(/\s+/g, " ")
    .trim()
  return cleaned.length <= limit
    ? cleaned
    : `${cleaned.slice(0, Math.max(0, limit - 1)).trimEnd()}…`
}

type HandoffAction = NonNullable<AgentConversationHandoff["actions"]>[number]

/**
 * The consequential things a run did, from its receipts: one per step, at
 * the step's last receipt, newest last. A step that was only proposed or
 * refused did nothing and is left out; one whose effect is unknown is kept
 * as uncertain, because a later turn has to say so rather than repeat it.
 */
export const agentHandoffActions = (
  steps: readonly Pick<
    AgentStepWrite,
    "stepId" | "status" | "consequential" | "target"
  >[]
): HandoffAction[] => {
  const latest = new Map<string, (typeof steps)[number]>()
  for (const step of steps) {
    latest.delete(step.stepId)
    latest.set(step.stepId, step)
  }
  return [...latest.values()]
    .filter(
      (step) =>
        (step.consequential?.length ?? 0) > 0 &&
        (step.status === "uncertain" || isAppliedAgentStepStatus(step.status))
    )
    .flatMap((step) => {
      const control = step.target?.name
        ? handoffPlainText(step.target.name, MAX_AGENT_HANDOFF_CONTROL_CHARS)
        : ""
      return (step.consequential ?? []).map((effect) => ({
        effect,
        state:
          step.status === "uncertain"
            ? ("uncertain" as const)
            : ("applied" as const),
        ...(control ? { control } : {})
      }))
    })
    .slice(-MAX_AGENT_HANDOFF_ACTIONS)
}

const isHandoffStatus = (
  status: AgentRunState["status"]
): status is AgentConversationHandoff["status"] =>
  (AGENT_HANDOFF_STATUSES as readonly string[]).includes(status)

/**
 * The handoff a settled run leaves in its chat row.
 *
 * `findings` are the run's own notes in the order it took them. Only the
 * newest are kept, deduplicated after cleaning, because a follow-up question
 * is almost always about where the run ended up rather than where it started.
 * Undefined for a status that is not settled: the commit that settles the run
 * is the only writer, and nothing else should be able to produce one.
 */
export const buildAgentConversationHandoff = (
  state: AgentRunState,
  findings: readonly string[],
  evidenceLedger: readonly AgentEvidenceRecord[] = [],
  actions: readonly HandoffAction[] = []
): AgentConversationHandoff | undefined => {
  if (!isHandoffStatus(state.status)) return undefined
  const goal = handoffPlainText(state.goal, MAX_AGENT_HANDOFF_GOAL_CHARS)
  if (!goal) return undefined
  const result = state.result
    ? handoffPlainText(state.result, MAX_AGENT_HANDOFF_RESULT_CHARS)
    : ""
  const notes = [
    ...new Set(
      findings
        .map((finding) => handoffPlainText(finding, MAX_AGENT_FINDING_CHARS))
        .filter(Boolean)
    )
  ].slice(-MAX_AGENT_HANDOFF_FINDINGS)

  return AgentConversationHandoffSchema.parse({
    version: 1,
    runId: state.id,
    status: state.status,
    goal,
    ...(result ? { result } : {}),
    ...(state.outcome
      ? {
          outcome: {
            met: state.outcome.met.length,
            total: state.outcome.met.length + state.outcome.unmet.length,
            ...(state.outcome.visual?.length
              ? { visual: state.outcome.visual.length }
              : {})
          }
        }
      : {}),
    ...(state.error ? { failure: state.error.code } : {}),
    ...(state.requirements?.length
      ? {
          requirements: state.requirements.flatMap((requirement) => {
            const text = handoffPlainText(
              requirement.text,
              MAX_AGENT_REQUIREMENT_CHARS
            )
            /**
             * No judgment is not "done": a run that failed or was stopped
             * before it was judged established nothing, and saying so is
             * what keeps a later turn from reporting the work as met. A
             * met outcome from before grading says it was met, ungraded.
             */
            const tier = state.outcome
              ? (agentRequirementTier(state.outcome, requirement.id) ??
                ("met" as const))
              : ("unjudged" as const)
            return text ? [{ id: requirement.id, text, tier }] : []
          })
        }
      : {}),
    ...(actions.length ? { actions: [...actions] } : {}),
    findings: notes,
    ...(evidenceLedger.length
      ? {
          evidenceLedger: boundAgentEvidence(
            evidenceLedger.filter(
              (record) =>
                !record.source ||
                state.allowedOrigins.includes(record.source.origin)
            )
          ).map((record) => ({
            ...record,
            ...(record.quote
              ? {
                  quote: handoffPlainText(
                    record.quote,
                    MAX_AGENT_SOURCE_QUOTE_CHARS
                  ),
                  ...(handoffPlainText(
                    record.quote,
                    MAX_AGENT_SOURCE_QUOTE_CHARS
                  ) !== record.quote
                    ? { validity: "incomplete" as const }
                    : {})
                }
              : {})
          }))
        }
      : {}),
    settledAt: state.updatedAt
  })
}
