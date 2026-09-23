import {
  type AgentRunState,
  MAX_AGENT_FINDING_CHARS
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
  findings: readonly string[]
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
            total: state.outcome.met.length + state.outcome.unmet.length
          }
        }
      : {}),
    ...(state.error ? { failure: state.error.code } : {}),
    findings: notes,
    settledAt: state.updatedAt
  })
}
