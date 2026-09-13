import {
  AgentMalformedDecisionError,
  agentAffordanceFeedback,
  classifyAgentAffordance
} from "@ollama-client/agent-runtime"
import {
  type AgentDecision,
  AgentDecisionSchema,
  type AgentObservation
} from "@ollama-client/contracts"
import { logger } from "@/lib/logger"
import type { ToolCall } from "@/lib/tools/types"

export const AGENT_DECISION_TOOL_NAME = "agent_decision"

/**
 * A rejected decision, with what the next attempt should be told.
 *
 * `feedback` is written for the model, so it is assembled from templates, the
 * ref the model itself supplied and structural facts about the document. No
 * page string reaches it: this text goes back out as part of a prompt, and a
 * page that could write into it would be writing instructions.
 */
export class AgentDecisionFormatError extends AgentMalformedDecisionError {
  readonly feedback?: string

  constructor(message: string, feedback?: string) {
    super(message)
    this.name = "AgentDecisionFormatError"
    if (feedback) this.feedback = feedback
  }
}

const SHAPE_FEEDBACK =
  'Call the tool named agent_decision only. Action names are its type argument, not tool names. Use flat arguments, e.g. {"type":"click","ref":"e1"} or {"type":"ask_user","question":"Which account?"}.'

const STALE_FEEDBACK =
  "The page snapshot moved on. Use only the refs listed in the observation supplied with this request."

const NO_SCREENSHOT_FEEDBACK =
  "No screenshot was attached to this observation, so click_point and zoom are not available. Use an element ref from the observation."

const VISUAL_COMMANDS = new Set(["click_point", "zoom"])

/**
 * The field each non-command decision carries, and the optional ones beside
 * it. A `complete` may name the evidence that supports it; everything else
 * the flat tool schema invited is dropped, as it is for a command.
 */
const VARIANT_FIELDS: Record<string, string> = {
  command: "command",
  ask_user: "question",
  complete: "summary",
  fail: "reason"
}

const VARIANT_OPTIONAL_FIELDS: Record<string, readonly string[]> = {
  complete: ["evidence"]
}

/**
 * The tool advertises one flat object covering every variant, so a model may
 * answer with the siblings it did not use — `summary: ""` beside a command,
 * say. The union's members are strict, and rejecting a usable decision over a
 * key the schema invited is not integrity, it is pedantry: only the field
 * belonging to the stated type is kept, and everything else about the answer
 * is still validated.
 */
const COMMAND_FIELDS: Record<string, readonly string[]> = {
  read: [],
  inspect: ["target"],
  find: ["query"],
  extract_text: ["offset", "frameId"],
  click: ["ref"],
  click_point: ["x", "y"],
  zoom: ["x", "y", "width", "height"],
  double_click: ["ref"],
  hover: ["ref"],
  type: ["ref", "text"],
  clear_and_type: ["ref", "text"],
  replace_text: ["ref", "find", "text"],
  drag: ["ref", "to"],
  select: ["ref", "value"],
  check: ["ref"],
  uncheck: ["ref"],
  press_key: ["ref", "key"],
  scroll: ["ref", "direction", "amount", "container"],
  navigate: ["url"],
  open_tab: ["url"],
  switch_tab: ["tabId"],
  handle_dialog: ["dialogId", "accept", "promptText"],
  back: [],
  forward: [],
  wait: ["condition", "timeoutMs"]
}

const DECISION_FIELDS = new Set([
  "type",
  "command",
  "finding",
  ...Object.values(COMMAND_FIELDS).flat(),
  ...Object.values(VARIANT_FIELDS),
  ...Object.values(VARIANT_OPTIONAL_FIELDS).flat()
])

/** Schema-owned field names only: never echo rejected values or Zod messages. */
const invalidFieldsFeedback = (
  issues: readonly { path: readonly PropertyKey[] }[],
  normalized: unknown
): string => {
  const fields = [
    ...new Set(
      issues.flatMap((issue) =>
        issue.path.filter(
          (part): part is string =>
            typeof part === "string" &&
            part !== "command" &&
            DECISION_FIELDS.has(part)
        )
      )
    )
  ]
  if (!fields.length) return SHAPE_FEEDBACK
  const isWait =
    normalized &&
    typeof normalized === "object" &&
    "command" in normalized &&
    normalized.command &&
    typeof normalized.command === "object" &&
    "type" in normalized.command &&
    normalized.command.type === "wait"
  return (
    `The agent_decision call has missing or invalid fields: ${fields.join(", ")}. Correct these fields using the tool schema and flat arguments.` +
    (isWait
      ? ' For wait, condition is required: the exact page text to wait for (1 to 500 characters), alongside timeoutMs (integer 1 to 30000). Example: {"type":"wait","condition":"All changes saved","timeoutMs":10000}.'
      : "")
  )
}

const normalizeDecisionArguments = (
  raw: unknown,
  observation: AgentObservation
): unknown => {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return raw
  const record = raw as Record<string, unknown>
  const fields = COMMAND_FIELDS[String(record.type)]
  if (fields) {
    if (
      (record.snapshotId !== undefined &&
        record.snapshotId !== observation.snapshotId) ||
      (record.generation !== undefined &&
        record.generation !== observation.generation)
    )
      throw new AgentDecisionFormatError(
        "The agent decision references a stale snapshot",
        STALE_FEEDBACK
      )
    const command: Record<string, unknown> = {
      type: record.type,
      snapshotId: observation.snapshotId,
      generation: observation.generation
    }
    for (const field of fields) {
      if (record[field] !== undefined) command[field] = record[field]
    }
    /** A finding belongs to the decision, not to the command's wire shape. */
    return record.finding === undefined
      ? { type: "command", command }
      : { type: "command", command, finding: record.finding }
  }
  const field = VARIANT_FIELDS[String(record.type)]
  if (!field) return raw
  const value = record[field]
  const optional = Object.fromEntries(
    (VARIANT_OPTIONAL_FIELDS[String(record.type)] ?? [])
      .filter((name) => record[name] !== undefined)
      .map((name) => [name, record[name]])
  )
  return value === undefined
    ? { type: record.type, ...optional }
    : { type: record.type, [field]: value, ...optional }
}

const assertGroundedDecision = (
  decision: AgentDecision,
  observation: AgentObservation
): AgentDecision => {
  if (
    decision.type === "command" &&
    (decision.command.snapshotId !== observation.snapshotId ||
      decision.command.generation !== observation.generation)
  ) {
    throw new AgentDecisionFormatError(
      "The agent decision references a stale snapshot",
      STALE_FEEDBACK
    )
  }
  /**
   * Asked here, where a wrong answer costs one retry, rather than only in the
   * trusted resolver, where it ended the run. Both use the same classifier.
   */
  if (decision.type === "command") {
    const refused = classifyAgentAffordance(decision.command, observation)
    if (refused) {
      throw new AgentDecisionFormatError(
        `The agent decision was refused: ${refused.reason}`,
        agentAffordanceFeedback(refused)
      )
    }
  }
  return decision
}

export interface AgentDecisionParseOptions {
  /** Whether a screenshot travelled with the observation the model decided on. */
  screenshot?: boolean
}

/** Accept exactly one native tool call and no provider-specific response shape. */
export const parseAgentDecisionToolCalls = (
  calls: readonly ToolCall[],
  observation: AgentObservation,
  options: AgentDecisionParseOptions = {}
): AgentDecision => {
  if (calls.length !== 1) {
    throw new AgentDecisionFormatError(
      `Expected one agent decision, received ${calls.length}`,
      SHAPE_FEEDBACK
    )
  }
  const call = calls[0]
  if (call.name !== AGENT_DECISION_TOOL_NAME) {
    throw new AgentDecisionFormatError(
      "The model called an unknown agent tool",
      SHAPE_FEEDBACK
    )
  }
  const normalized = normalizeDecisionArguments(call.arguments, observation)
  /**
   * A visual command without a picture is refused at parse time, where it
   * costs a retry, rather than at resolution, where it would end the run. The
   * tool schema a text-only model sees never offers these, so reaching here
   * means the model invented one.
   */
  if (
    normalized &&
    typeof normalized === "object" &&
    "command" in normalized &&
    VISUAL_COMMANDS.has(
      String((normalized as { command?: { type?: unknown } }).command?.type)
    ) &&
    !options.screenshot
  ) {
    throw new AgentDecisionFormatError(
      "The agent decision used a visual command without a screenshot",
      NO_SCREENSHOT_FEEDBACK
    )
  }
  const parsed = AgentDecisionSchema.safeParse(normalized)
  if (!parsed.success) {
    /**
     * Shape only. Which keys a model sent, and which field of the schema each
     * complaint is about, is what tells a schema mismatch apart from a model
     * that answered badly — the values are page-derived and stay out.
     */
    logger.warn("Agent decision rejected", "Agent", {
      keys:
        normalized && typeof normalized === "object"
          ? Object.keys(normalized as Record<string, unknown>)
          : typeof normalized,
      decisionType:
        normalized && typeof normalized === "object"
          ? String((normalized as Record<string, unknown>).type)
          : "unknown",
      paths: parsed.error.issues.map((issue) => issue.path.join(".")),
      codes: parsed.error.issues.map((issue) => issue.code)
    })
    throw new AgentDecisionFormatError(
      "The model returned an invalid decision",
      invalidFieldsFeedback(parsed.error.issues, normalized)
    )
  }
  return assertGroundedDecision(parsed.data, observation)
}
