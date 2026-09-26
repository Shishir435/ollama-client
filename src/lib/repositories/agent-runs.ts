import {
  AGENT_STATUS_PREDECESSORS,
  type AgentClaimResult,
  type AgentPersistencePort,
  type AgentPhaseClaim,
  type AgentStatePatch,
  type AgentStepWrite,
  type AgentTransitionResult,
  type AgentTransitionWrite,
  isTerminalAgentStatus,
  MAX_AGENT_SUBMITTED_VALUE_CHARS,
  MAX_AGENT_SUBMITTED_VALUES,
  TERMINAL_AGENT_STATUSES
} from "@ollama-client/agent-runtime"
import {
  AGENT_CONSEQUENTIAL_EFFECTS,
  type AgentCommand,
  AgentCommandSchema,
  AgentConsequentialEffectSchema,
  AgentDeadlineStateSchema,
  type AgentRunState,
  AgentRunStateSchema,
  type AgentRunStatus,
  AgentRunStatusSchema,
  AgentStepStatusSchema,
  AgentStepTelemetrySchema,
  MAX_AGENT_FINDING_CHARS,
  MAX_AGENT_OBSERVATIONS,
  MAX_AGENT_REQUIREMENT_ID_CHARS,
  MAX_AGENT_ROW_CONTEXT_CHARS,
  MAX_AGENT_THINKING_CHARS
} from "@ollama-client/contracts"
import { z } from "zod"
import { logger } from "@/lib/logger"
import { PERSISTENCE_LIMITS } from "@/lib/persistence/protocol"
import {
  flushSave,
  query,
  runWithMeta,
  type SqlExecutor,
  withTransaction
} from "@/lib/sqlite/db"
import { buildAgentConversationHandoff } from "./agent-run-handoff"
import { decodeRow, decodeRows, type RowDecodeContext } from "./row-decoder"

export const MAX_AGENT_CHECKPOINT_BYTES = 64 * 1024
export const MAX_AGENT_STEP_RECEIPT_BYTES = 16 * 1024
/**
 * The most distinct steps one run's rows may hold.
 *
 * This is a corruption bound, not the budget: the controller stops a run at
 * `MAX_AGENT_OBSERVATIONS`, and this exists so a loop that escapes it cannot
 * fill the table. It sits above the budget rather than on it for that reason
 * — the run must end because it ran out of steps, with the reason the panel
 * knows how to explain, never because an INSERT refused.
 *
 * It was the literal 25, written when that was the ceiling, and it stayed
 * behind when the ceiling moved: every run died at step 26 with "Agent run
 * exceeds its 25-step limit", which is a persistence error wearing a budget's
 * words. The raise to fifty steps did nothing until this moved with it.
 */
export const MAX_AGENT_STEPS = MAX_AGENT_OBSERVATIONS + 5
export const TERMINAL_AGENT_RETENTION_MS = 30 * 24 * 60 * 60 * 1000

const TABLE: RowDecodeContext = { table: "agent_runs", operation: "read" }
const STEP_TABLE: RowDecodeContext = { table: "agent_steps", operation: "read" }

/**
 * A linkage column is nullable in SQL and therefore arrives as `null`, which a
 * decoder must accept and a caller must never see: absent and null say the
 * same thing here, and two spellings of it would be two branches at every
 * reader.
 */
const linkColumn = <T extends z.ZodTypeAny>(schema: T) =>
  schema.nullish().transform((value) => value ?? undefined)

const AgentRunRowSchema = z.object({
  id: z.string(),
  status: AgentRunStatusSchema,
  checkpoint: z.string(),
  createdAt: z.number(),
  updatedAt: z.number(),
  sessionId: linkColumn(z.string()),
  requestMessageId: linkColumn(z.number()),
  resultMessageId: linkColumn(z.number()),
  parentRunId: linkColumn(z.string())
})

const AgentRunIdRowSchema = z.object({ id: z.string() })

const AgentVerificationSchema = z
  .object({
    outcome: z.enum(["confirmed", "negative", "ambiguous"]),
    evidence: z
      .object({
        kind: z.string().max(200),
        summary: z.string().max(2_000),
        observedAt: z.number().int().nonnegative(),
        fields: z
          .array(
            z
              .object({
                name: z.string().max(120).optional()
              })
              .strict()
          )
          .max(12)
          .optional(),
        values: z
          .array(z.string().max(MAX_AGENT_SUBMITTED_VALUE_CHARS))
          .max(MAX_AGENT_SUBMITTED_VALUES)
          .optional()
      })
      .strict()
  })
  .strict()

/**
 * What a step acted on. A `ref` means nothing after the next observation, so
 * a receipt that held only the command could not describe its own history.
 * The name is page text and is therefore bounded, and dropped entirely for a
 * sensitive control, exactly as the command's value already is.
 */
const AgentStepTargetSchema = z
  .object({
    ref: z.string().max(40).optional(),
    tag: z.string().max(40).optional(),
    role: z.string().max(60).optional(),
    name: z.string().max(120).optional(),
    rowContext: z.string().max(MAX_AGENT_ROW_CONTEXT_CHARS).optional()
  })
  .strict()

const AgentStepReceiptSchema = z
  .object({
    version: z.literal(1),
    runId: z.string().min(1),
    stepId: z.string().min(1),
    status: AgentStepStatusSchema,
    at: z.number().int().nonnegative(),
    command: AgentCommandSchema.optional(),
    requirementId: z
      .string()
      .min(1)
      .max(MAX_AGENT_REQUIREMENT_ID_CHARS)
      .optional(),
    risk: z.enum(["low", "medium", "high", "critical"]).optional(),
    /** Whether the step changed the page; a completion is judged against it. */
    mutating: z.boolean().optional(),
    /** What a repeat would double; a follow-up reads this. */
    consequential: z
      .array(AgentConsequentialEffectSchema)
      .max(AGENT_CONSEQUENTIAL_EFFECTS.length)
      .optional(),
    /** Where a consequential submission was sent, origin and path only. */
    formAction: z.string().max(2_048).optional(),
    verification: AgentVerificationSchema.optional(),
    target: AgentStepTargetSchema.optional(),
    sourceUrl: z.string().max(2_048).optional(),
    finding: z.string().max(MAX_AGENT_FINDING_CHARS).optional(),
    /** Display-only reasoning for the card; never read back into a prompt. */
    thinking: z.string().max(MAX_AGENT_THINKING_CHARS).optional(),
    /**
     * Numbers only, and bounded by its own schema. It rides the receipt
     * because the receipts are what a worker restart leaves behind, and an
     * interrupted run is the one worth measuring.
     */
    telemetry: AgentStepTelemetrySchema.optional()
  })
  .strict()

const AgentStepRowSchema = z.object({
  id: z.number(),
  runId: z.string(),
  stepId: z.string(),
  status: AgentStepStatusSchema,
  receipt: z.string(),
  createdAt: z.number()
})

const REDACTED_AGENT_VALUE = "[redacted]"

const redactAgentStepCommand = (
  command?: AgentCommand
): AgentCommand | undefined => {
  if (!command) return undefined
  if (
    command.type === "type" ||
    command.type === "clear_and_type" ||
    command.type === "replace_text"
  ) {
    return { ...command, text: REDACTED_AGENT_VALUE }
  }
  if (command.type === "select") {
    return { ...command, value: REDACTED_AGENT_VALUE }
  }
  /**
   * A batch carries up to twelve field values, and a durable receipt is read
   * back into a prompt. Redacted field by field rather than dropped, so the
   * receipt still records which controls the step set and in what order.
   */
  if (command.type === "fill_form") {
    return {
      ...command,
      fields: command.fields.map((field) =>
        field.type === "select"
          ? { ...field, value: REDACTED_AGENT_VALUE }
          : field.type === "check" || field.type === "uncheck"
            ? field
            : { ...field, text: REDACTED_AGENT_VALUE }
      )
    }
  }
  return command
}

/**
 * Bounded again at the write, not only where the controller assembles it: a
 * receipt is read back into a prompt, and a cap that lived in one place would
 * be a cap that one caller could forget.
 */
const boundedStepTarget = (
  target: NonNullable<AgentStepWrite["target"]>
): NonNullable<AgentStepWrite["target"]> => ({
  ...(target.ref ? { ref: target.ref.slice(0, 40) } : {}),
  ...(target.tag ? { tag: target.tag.slice(0, 40) } : {}),
  ...(target.role ? { role: target.role.slice(0, 60) } : {}),
  ...(target.name ? { name: target.name.slice(0, 120) } : {}),
  ...(target.rowContext
    ? { rowContext: target.rowContext.slice(0, MAX_AGENT_ROW_CONTEXT_CHARS) }
    : {})
})

const AgentCheckpointSchema = z
  .object({ version: z.literal(1), state: AgentRunStateSchema })
  .strict()

const CompactedAgentCheckpointSchema = z
  .object({
    version: z.literal(1),
    compacted: z.literal(true),
    terminalAt: z.number().int().nonnegative(),
    /**
     * Terminal state is already bounded and contains no page snapshot. Keep it
     * so the panel can show completion/failure after the terminal CAS or an
     * MV3 worker restart. Optional preserves reads of older compacted rows.
     */
    state: AgentRunStateSchema.optional()
  })
  .strict()

type AgentRunRow = z.infer<typeof AgentRunRowSchema>

/**
 * Which conversation a run belongs to, held beside `AgentRunState` and never
 * inside it: the browser controller plans, observes and verifies without any
 * concept of a chat, and a field it can read is a field it can be asked to
 * decide by.
 */
export interface AgentRunLink {
  /** The chat this run was started from. */
  sessionId?: string
  /** The user message that launched it. */
  requestMessageId?: number
  /** The assistant row its card and result are written to. */
  resultMessageId?: number
  /** The run this one continues, when a follow-up carried its handoff. */
  parentRunId?: string
}

export interface DurableAgentRun extends AgentRunLink {
  id: string
  status: AgentRunStatus
  state?: AgentRunState
  compacted: boolean
  createdAt: number
  updatedAt: number
}

export interface DurableAgentStep extends AgentStepWrite {
  sequence: number
}

const byteLength = (value: string): number =>
  new TextEncoder().encode(value).length

const FORBIDDEN_KEYS = new Set([
  "cookie",
  "cookies",
  "password",
  "passcode",
  "otp",
  "verificationcode",
  "cardnumber",
  "cvv",
  "screenshot",
  "pagebody",
  "visibletext",
  "html",
  "dom",
  "hiddenreasoning"
])

const assertPrivacySafe = (value: unknown, path = "checkpoint"): void => {
  if (typeof value === "string" && /^data:image\//i.test(value)) {
    throw new Error(`${path} must not contain screenshot bytes`)
  }
  if (!value || typeof value !== "object") return
  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      assertPrivacySafe(item, `${path}[${index}]`)
    })
    return
  }
  for (const [key, child] of Object.entries(value)) {
    const normalized = key.replace(/[^a-z]/gi, "").toLowerCase()
    if (FORBIDDEN_KEYS.has(normalized)) {
      throw new Error(`${path} contains forbidden field ${key}`)
    }
    assertPrivacySafe(child, `${path}.${key}`)
  }
}

const serializeBounded = (
  value: unknown,
  limit: number,
  label: string
): string => {
  assertPrivacySafe(value, label)
  const serialized = JSON.stringify(value)
  if (byteLength(serialized) > limit) {
    throw new Error(`${label} exceeds its ${limit}-byte limit`)
  }
  return serialized
}

const serializeCheckpoint = (state: AgentRunState): string => {
  const parsed = AgentRunStateSchema.parse(state)
  return serializeBounded(
    { version: 1, state: parsed },
    MAX_AGENT_CHECKPOINT_BYTES,
    "Agent checkpoint"
  )
}

const compactedCheckpoint = (
  terminalAt: number,
  state?: AgentRunState
): string =>
  serializeBounded(
    {
      version: 1,
      compacted: true,
      terminalAt,
      ...(state
        ? {
            state: AgentRunStateSchema.parse({
              ...state,
              deadline: undefined,
              pauseReason: undefined
            })
          }
        : {})
    },
    MAX_AGENT_CHECKPOINT_BYTES,
    "Agent terminal checkpoint"
  )

const parseRun = (row: AgentRunRow): DurableAgentRun | null => {
  try {
    const decoded: unknown = JSON.parse(row.checkpoint)
    const compacted = CompactedAgentCheckpointSchema.safeParse(decoded)
    if (compacted.success) {
      if (!isTerminalAgentStatus(row.status)) return null
      if (
        compacted.data.state &&
        (compacted.data.state.id !== row.id ||
          compacted.data.state.status !== row.status)
      ) {
        return null
      }
      return { ...row, state: compacted.data.state, compacted: true }
    }
    const checkpoint = AgentCheckpointSchema.parse(decoded)
    if (
      checkpoint.state.id !== row.id ||
      checkpoint.state.status !== row.status
    ) {
      return null
    }
    return { ...row, state: checkpoint.state, compacted: false }
  } catch {
    return null
  }
}

const selectRunColumns =
  "id, status, checkpoint, createdAt, updatedAt, sessionId, requestMessageId, resultMessageId, parentRunId"

export const createAgentRun = async (
  state: AgentRunState,
  link: AgentRunLink = {}
): Promise<void> => {
  if (state.status !== "submitted") {
    throw new Error("A durable agent run must begin in submitted status")
  }
  await runWithMeta(...insertAgentRunStatement(state, link))
  await flushSave()
}

/**
 * The INSERT on its own, so the same statement can be issued inside a larger
 * transaction — the one that also writes the request message and the assistant
 * row this run reports into. A run created outside that commit is a run whose
 * card may not exist.
 */
export const insertAgentRunStatement = (
  state: AgentRunState,
  link: AgentRunLink
): [string, (string | number | null)[]] => [
  `INSERT INTO agent_runs
     (id, status, checkpoint, createdAt, updatedAt,
      sessionId, requestMessageId, resultMessageId, parentRunId)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  [
    state.id,
    state.status,
    serializeCheckpoint(state),
    state.createdAt,
    state.updatedAt,
    link.sessionId ?? null,
    link.requestMessageId ?? null,
    link.resultMessageId ?? null,
    link.parentRunId ?? null
  ]
]

export const getAgentRun = async (
  id: string
): Promise<DurableAgentRun | null> => {
  const rows = await query(
    `SELECT ${selectRunColumns} FROM agent_runs WHERE id = ?`,
    [id]
  )
  const row = rows[0] ? decodeRow(AgentRunRowSchema, rows[0], TABLE) : null
  return row ? parseRun(row) : null
}

/**
 * The run filed against an assistant row, if one is. A chat turn delegates at
 * most one run into its row, so a tool call replayed after a worker restart
 * finds the run it already started instead of starting a second.
 */
export const getAgentRunForResultMessage = async (
  messageId: number
): Promise<DurableAgentRun | null> => {
  const rows = await query(
    `SELECT ${selectRunColumns} FROM agent_runs
      WHERE resultMessageId = ?
      ORDER BY createdAt DESC LIMIT 1`,
    [messageId]
  )
  const row = rows[0] ? decodeRow(AgentRunRowSchema, rows[0], TABLE) : null
  return row ? parseRun(row) : null
}

const applyPatch = (
  state: AgentRunState,
  status: AgentRunStatus,
  patch?: AgentStatePatch
): AgentRunState => AgentRunStateSchema.parse({ ...state, ...patch, status })

const appendStepInTransaction = async (
  tx: SqlExecutor,
  input: AgentStepWrite
): Promise<void> => {
  const receipt = AgentStepReceiptSchema.parse({
    version: 1,
    ...input,
    command: redactAgentStepCommand(input.command),
    ...(input.target ? { target: boundedStepTarget(input.target) } : {}),
    ...(input.finding
      ? { finding: input.finding.slice(0, MAX_AGENT_FINDING_CHARS) }
      : {}),
    ...(input.thinking
      ? { thinking: input.thinking.slice(-MAX_AGENT_THINKING_CHARS) }
      : {})
  })
  const serialized = serializeStepReceipt(receipt)
  const existing = await tx.query(
    "SELECT COUNT(DISTINCT stepId) AS count FROM agent_steps WHERE runId = ?",
    [input.runId]
  )
  const known = await tx.query(
    "SELECT 1 AS found FROM agent_steps WHERE runId = ? AND stepId = ? LIMIT 1",
    [input.runId, input.stepId]
  )
  const count = typeof existing[0]?.count === "number" ? existing[0].count : 0
  if (known.length === 0 && count >= MAX_AGENT_STEPS) {
    throw new Error(`Agent run exceeds its ${MAX_AGENT_STEPS}-step limit`)
  }
  await tx.run(
    `INSERT INTO agent_steps (runId, stepId, status, receipt, createdAt)
     VALUES (?, ?, ?, ?, ?)`,
    [input.runId, input.stepId, input.status, serialized, input.at]
  )
}

/**
 * The reasoning is the one field a receipt can lose without losing what the
 * step did, so a receipt the cap refuses is retried without it rather than
 * failing a step over text only the card would have shown.
 */
const serializeStepReceipt = (
  receipt: z.infer<typeof AgentStepReceiptSchema>
): string => {
  try {
    return serializeBounded(
      receipt,
      MAX_AGENT_STEP_RECEIPT_BYTES,
      "Agent step receipt"
    )
  } catch (error) {
    if (!receipt.thinking) throw error
    const { thinking: _thinking, ...rest } = receipt
    return serializeBounded(
      rest,
      MAX_AGENT_STEP_RECEIPT_BYTES,
      "Agent step receipt"
    )
  }
}

const findLatestCommandReceipt = async (
  tx: SqlExecutor,
  runId: string
): Promise<z.infer<typeof AgentStepReceiptSchema> | undefined> => {
  const latest = await tx.query(
    "SELECT stepId FROM agent_steps WHERE runId = ? ORDER BY id DESC LIMIT 1",
    [runId]
  )
  const stepId = latest[0]?.stepId
  if (typeof stepId !== "string") return undefined
  const rows = await tx.query(
    `SELECT receipt FROM agent_steps
      WHERE runId = ? AND stepId = ? AND status IN ('planned', 'approved')
      ORDER BY id DESC`,
    [runId, stepId]
  )
  for (const row of rows) {
    if (typeof row.receipt !== "string") continue
    try {
      const parsed = AgentStepReceiptSchema.safeParse(JSON.parse(row.receipt))
      if (parsed.success && parsed.data.command) return parsed.data
    } catch {
      // A bad evidence row cannot authorize execution; continue looking for
      // the last valid, bounded planned command for this run.
    }
  }
  return undefined
}

export const appendAgentStep = async (input: AgentStepWrite): Promise<void> => {
  await withTransaction((tx) => appendStepInTransaction(tx, input))
  await flushSave()
}

/**
 * The notes a run kept, one per step and in the order it took them.
 *
 * Read inside the settling transaction, from the same receipts the panel and
 * the judge read, so the handoff cannot describe a different run than the one
 * being settled. A receipt that does not decode contributes nothing: it is
 * evidence for an audit, and the audit is where it stays.
 */
const listRunFindings = async (
  tx: Pick<SqlExecutor, "query">,
  runId: string
): Promise<string[]> => {
  const rows = await tx.query(
    "SELECT stepId, receipt FROM agent_steps WHERE runId = ? ORDER BY id ASC",
    [runId]
  )
  const latest = new Map<string, string>()
  for (const row of rows) {
    if (typeof row.receipt !== "string" || typeof row.stepId !== "string")
      continue
    try {
      const parsed = AgentStepReceiptSchema.safeParse(JSON.parse(row.receipt))
      if (parsed.success && parsed.data.finding) {
        latest.delete(row.stepId)
        latest.set(row.stepId, parsed.data.finding)
      }
    } catch {
      // Unreadable evidence adds nothing to what a later turn is told.
    }
  }
  return [...latest.values()]
}

/**
 * Close the assistant row a run reports into, in the commit that settles the
 * run.
 *
 * Written here rather than in a pass afterwards for the reason every other
 * terminal write in this file is: a worker that dies between the two leaves a
 * settled run above a bubble that streams forever, and nothing later knows to
 * look. Guarded on `done = 0` so it cannot overwrite a row a user or a later
 * turn has already finished.
 *
 * The result text is a fallback, not the card: a run that ended with nothing
 * to say leaves the content alone and only stops the row waiting. The handoff
 * is what a later turn in this branch reads instead of the step log, written
 * in the same statement so a settled run is never without one.
 */
const settleLinkedMessage = async (
  tx: Pick<SqlExecutor, "run" | "query">,
  resultMessageId: number | undefined,
  state: AgentRunState
): Promise<void> => {
  if (resultMessageId === undefined) return
  const result = state.result?.trim()
  const handoff = buildAgentConversationHandoff(
    state,
    await listRunFindings(tx, state.id)
  )
  /**
   * A run a chat model delegated reports into a row its turn is still
   * streaming: the model answers once the run settles, and the turn finishes
   * the row. Closing it here would mark a live answer done, and writing the
   * result would be overwritten by that answer anyway.
   */
  if (!state.goalAuthor) {
    await tx.run(
      `UPDATE messages
          SET done = 1, updatedAt = ?${result ? ", content = ?" : ""}
        WHERE id = ? AND done = 0`,
      result
        ? [state.updatedAt, result, resultMessageId]
        : [state.updatedAt, resultMessageId]
    )
  }
  /**
   * Its own statement, and not guarded on `done`: a row something else
   * already finished still belongs to this run, and a later turn is owed its
   * handoff either way. Guarded on being unwritten instead, so the one writer
   * cannot be overwritten by a second settle.
   */
  if (handoff) {
    await tx.run(
      "UPDATE messages SET agentHandoff = ? WHERE id = ? AND agentHandoff IS NULL",
      [JSON.stringify(handoff), resultMessageId]
    )
  }
}

const updateAgentRun = async (
  input: AgentPhaseClaim | AgentTransitionWrite,
  target: AgentRunStatus,
  expected: readonly AgentRunStatus[]
): Promise<AgentRunState | undefined> => {
  if (expected.length === 0) return undefined
  let claimed: AgentRunState | undefined
  await withTransaction(async (tx) => {
    const rows = await tx.query(
      `SELECT ${selectRunColumns} FROM agent_runs WHERE id = ?`,
      [input.runId]
    )
    const row = rows[0] ? decodeRow(AgentRunRowSchema, rows[0], TABLE) : null
    const current = row ? parseRun(row) : null
    if (!current?.state || !expected.includes(current.status)) return

    const next = applyPatch(current.state, target, input.patch)
    const terminal = isTerminalAgentStatus(target)
    const checkpoint = terminal
      ? compactedCheckpoint(next.updatedAt, next)
      : serializeCheckpoint(next)
    const placeholders = expected.map(() => "?").join(", ")
    const result = await tx.runWithMeta(
      `UPDATE agent_runs
          SET status = ?, checkpoint = ?, updatedAt = ?
        WHERE id = ? AND status IN (${placeholders})`,
      [target, checkpoint, next.updatedAt, input.runId, ...expected]
    )
    if (result.changes === 0) return

    if (terminal) await settleLinkedMessage(tx, current.resultMessageId, next)

    // Entering execution is the durable effect-ownership boundary. Copy the
    // latest bounded step receipt into an append-only `executing` claim in the
    // same transaction as the run CAS, before an executor can be called.
    if (target === "executing") {
      const prior = await findLatestCommandReceipt(tx, input.runId)
      if (!prior) {
        throw new Error("Agent execution has no durable planned step")
      }
      await appendStepInTransaction(tx, {
        ...prior,
        status: "executing",
        at: next.updatedAt
      })
    }
    claimed = next
  })
  if (claimed) await flushSave()
  return claimed
}

export const claimAgentRunPhase = async (
  input: AgentPhaseClaim
): Promise<AgentClaimResult> => {
  const legal = AGENT_STATUS_PREDECESSORS[
    input.phase
  ] as readonly AgentRunStatus[]
  const expected = input.expected.filter((status) => legal.includes(status))
  const state = await updateAgentRun(input, input.phase, expected)
  return state ? { claimed: true, state } : { claimed: false }
}

export const transitionAgentRun = async (
  input: AgentTransitionWrite
): Promise<AgentTransitionResult> => {
  const legal = AGENT_STATUS_PREDECESSORS[input.to]
  if (!(legal as readonly AgentRunStatus[]).includes(input.from)) {
    return { transitioned: false }
  }
  if (
    (input.from === "executing" || input.from === "verifying") &&
    (input.to === "pause_requested" || input.to === "cancelling")
  ) {
    const interrupted = await markInterruptedAgentEffect(
      input.runId,
      input.to,
      input.patch?.updatedAt ?? Date.now(),
      input.from
    )
    const state = interrupted
      ? (await getAgentRun(input.runId))?.state
      : undefined
    return state ? { transitioned: true, state } : { transitioned: false }
  }
  const state = await updateAgentRun(input, input.to, [input.from])
  return state ? { transitioned: true, state } : { transitioned: false }
}

const readAgentSteps = async (
  runId: string,
  requireComplete: boolean
): Promise<DurableAgentStep[]> => {
  const rows = await query(
    `SELECT id, runId, stepId, status, receipt, createdAt
       FROM agent_steps WHERE runId = ? ORDER BY id ASC`,
    [runId]
  )
  const decoded = decodeRows(AgentStepRowSchema, rows, STEP_TABLE)
  const steps: DurableAgentStep[] = []
  let incomplete = decoded.length !== rows.length
  for (const row of decoded) {
    try {
      const receipt = AgentStepReceiptSchema.parse(JSON.parse(row.receipt))
      if (
        receipt.runId === row.runId &&
        receipt.stepId === row.stepId &&
        receipt.status === row.status
      ) {
        const { version: _version, ...step } = receipt
        steps.push({ ...step, sequence: row.id })
      } else {
        incomplete = true
        logger.warn("Refused a mismatched agent step receipt", "AgentRuns", {
          rowId: String(row.id)
        })
      }
    } catch {
      incomplete = true
      logger.warn("Refused an unreadable agent step receipt", "AgentRuns", {
        rowId: String(row.id)
      })
    }
  }
  if (requireComplete && incomplete) {
    throw new Error("Agent step history is incomplete")
  }
  return steps
}

/** Panel history may show readable rows; decisions require the entire record. */
export const listAgentSteps = (runId: string): Promise<DurableAgentStep[]> =>
  readAgentSteps(runId, false)

export const listCompleteAgentSteps = (
  runId: string
): Promise<DurableAgentStep[]> => readAgentSteps(runId, true)

/**
 * The most recently started run, settled or not.
 *
 * The panel shows what happened last, and an MV3 worker that restarted after
 * a run ended remembers nothing — so the record has to come from the table
 * rather than from whichever service instance happens to be alive.
 */
export const getLatestAgentRun = async (): Promise<DurableAgentRun | null> => {
  const rows = await query(
    `SELECT ${selectRunColumns} FROM agent_runs
      ORDER BY createdAt DESC, id DESC
      LIMIT 1`
  )
  const row = rows[0] ? decodeRow(AgentRunRowSchema, rows[0], TABLE) : null
  return row ? parseRun(row) : null
}

export const listIncompleteAgentRuns = async (): Promise<DurableAgentRun[]> => {
  const rows = await query(
    `SELECT ${selectRunColumns} FROM agent_runs
      WHERE status NOT IN ('completed', 'failed', 'cancelled')
      ORDER BY createdAt ASC`
  )
  const result: DurableAgentRun[] = []
  for (const value of rows) {
    const row = decodeRow(AgentRunRowSchema, value, TABLE)
    const parsed = row ? parseRun(row) : null
    if (parsed?.state) {
      result.push(parsed)
      continue
    }
    const id = row?.id ?? decodeRow(AgentRunIdRowSchema, value, TABLE)?.id
    if (id) await quarantineAgentRun(id).catch(() => undefined)
  }
  return result
}

/**
 * Atomically turn an interrupted effect boundary into durable uncertainty.
 * Neither the run nor its evidence can commit alone, so every later reader
 * sees both the pause claim and the instruction never to repeat the effect.
 */
const markInterruptedAgentEffect = async (
  runId: string,
  target: "pause_requested" | "cancelling",
  now = Date.now(),
  expected?: "executing" | "verifying"
): Promise<boolean> => {
  let changed = false
  await withTransaction(async (tx) => {
    const rows = await tx.query(
      `SELECT ${selectRunColumns} FROM agent_runs WHERE id = ?`,
      [runId]
    )
    const row = rows[0] ? decodeRow(AgentRunRowSchema, rows[0], TABLE) : null
    const current = row ? parseRun(row) : null
    if (
      !current?.state ||
      (current.status !== "executing" && current.status !== "verifying") ||
      (expected !== undefined && current.status !== expected)
    ) {
      return
    }
    const stepRows = await tx.query(
      `SELECT receipt FROM agent_steps
        WHERE runId = ? ORDER BY id DESC LIMIT 1`,
      [runId]
    )
    const receiptValue = stepRows[0]?.receipt
    if (typeof receiptValue !== "string") {
      throw new Error("Interrupted agent effect has no durable step claim")
    }
    const prior = AgentStepReceiptSchema.parse(JSON.parse(receiptValue))
    const next = applyPatch(current.state, target, {
      ...(target === "pause_requested"
        ? { pauseReason: "unresolved_effect" as const }
        : {}),
      updatedAt: now
    })
    const result = await tx.runWithMeta(
      `UPDATE agent_runs SET status = ?, checkpoint = ?, updatedAt = ?
        WHERE id = ? AND status = ?`,
      [target, serializeCheckpoint(next), now, runId, current.status]
    )
    if (result.changes === 0) return
    await appendStepInTransaction(tx, {
      ...prior,
      status: "uncertain",
      verification: {
        outcome: "ambiguous",
        evidence: {
          kind: "worker_termination",
          summary: "The browser effect may have occurred before recovery.",
          observedAt: now
        }
      },
      at: now
    })
    changed = true
  })
  if (changed) await flushSave()
  return changed
}

export const markInterruptedAgentEffectUncertain = (
  runId: string,
  now = Date.now()
): Promise<boolean> => markInterruptedAgentEffect(runId, "pause_requested", now)

const quarantineAgentRun = async (id: string): Promise<void> => {
  const now = Date.now()
  let changed = false
  await withTransaction(async (tx) => {
    const result = await tx.runWithMeta(
      `UPDATE agent_runs SET status = 'failed', checkpoint = ?, updatedAt = ?
        WHERE id = ? AND status NOT IN ('completed', 'failed', 'cancelled')`,
      [compactedCheckpoint(now), now, id]
    )
    if (result.changes === 0) return
    changed = true
    /*
     * A row this undecodable has no state to read a result from, so the only
     * thing owed to its message is that it stop waiting. Left out, the one
     * failure that cannot explain itself is also the one that leaves a bubble
     * streaming forever.
     */
    await tx.run(
      `UPDATE messages SET done = 1, updatedAt = ?
        WHERE done = 0 AND id IN (
          SELECT resultMessageId FROM agent_runs WHERE id = ?
        )`,
      [now, id]
    )
  })
  if (changed) await flushSave()
}

export const countAgentRuns = async (): Promise<number> => {
  const rows = await query("SELECT COUNT(*) AS count FROM agent_runs")
  return typeof rows[0]?.count === "number" ? rows[0].count : 0
}

export const pruneTerminalAgentRuns = async (
  olderThan = Date.now() - TERMINAL_AGENT_RETENTION_MS,
  signal?: AbortSignal
): Promise<number> => {
  signal?.throwIfAborted()
  const result = await runWithMeta(
    `DELETE FROM agent_runs
      WHERE status IN ('completed', 'failed', 'cancelled')
        AND updatedAt < ?
        AND NOT EXISTS (
          SELECT 1 FROM agent_steps
           WHERE agent_steps.runId = agent_runs.id
             AND agent_steps.status = 'uncertain'
        )`,
    [olderThan]
  )
  if (result.changes > 0) await flushSave()
  signal?.throwIfAborted()
  return result.changes
}

/**
 * A run nobody has settled yet. Written out rather than reusing the incomplete
 * query above, because that one deliberately treats `partial` as resumable and
 * this one is asking a different question: whether stopping it is still owed.
 */
const LIVE_RUNS = `status NOT IN (${TERMINAL_AGENT_STATUSES.map(() => "?").join(", ")})`
const LIVE_STATUSES = [...TERMINAL_AGENT_STATUSES]

const idsFrom = (rows: Awaited<ReturnType<typeof query>>): string[] =>
  rows.flatMap((row) =>
    typeof row.id === "string" && row.id.length > 0 ? [row.id] : []
  )

/**
 * Split message ids so one statement never outgrows the persistence protocol's
 * bind ceiling.
 *
 * `repeats` is how many times the statement names each id — the orphan UPDATE
 * names every id four times, once per `CASE` and once per `WHERE` arm. Left
 * unbatched, a deleted subtree of a few thousand messages was refused by the
 * owner, and the cleanup that refusal skipped is what keeps a live run from
 * outliving its card.
 */
const messageIdBatches = (
  messageIds: number[],
  repeats: number,
  reserved = 0
): number[][] => {
  const perBatch = Math.max(
    1,
    Math.floor((PERSISTENCE_LIMITS.bindValues - reserved) / repeats)
  )
  const batches: number[][] = []
  for (let offset = 0; offset < messageIds.length; offset += perBatch) {
    batches.push(messageIds.slice(offset, offset + perBatch))
  }
  return batches
}

/**
 * Runs still executing that report into one of these messages.
 *
 * Asked before a subtree is deleted, so the caller can stop them first. A run
 * whose card is gone keeps driving a browser tab and writing to a row nobody
 * can read, which is the worst of both: the effects continue and the evidence
 * does not.
 */
export const listLiveAgentRunsForMessages = async (
  messageIds: number[]
): Promise<string[]> => {
  const found = new Set<string>()
  for (const batch of messageIdBatches(messageIds, 2, LIVE_STATUSES.length)) {
    const slots = batch.map(() => "?").join(", ")
    const rows = await query(
      `SELECT id FROM agent_runs
        WHERE ${LIVE_RUNS}
          AND (requestMessageId IN (${slots}) OR resultMessageId IN (${slots}))`,
      [...LIVE_STATUSES, ...batch, ...batch]
    )
    for (const id of idsFrom(rows)) found.add(id)
  }
  return [...found]
}

/** The same question for a whole chat, asked before the chat is deleted. */
export const listLiveAgentRunsForSession = async (
  sessionId: string
): Promise<string[]> =>
  idsFrom(
    await query(
      `SELECT id FROM agent_runs WHERE sessionId = ? AND ${LIVE_RUNS}`,
      [sessionId, ...LIVE_STATUSES]
    )
  )

/**
 * Drop the pointers to messages that no longer exist, keeping the run.
 *
 * Deleting a branch of a conversation is not a request to destroy what the
 * agent did in the world: the receipts in `agent_steps` are the only record
 * that a form was submitted or a purchase made, and they outlive the bubble
 * that reported them. Idempotent, and called after the delete commits by the
 * id list that commit returned — the same shape the vector cleanup uses, and
 * for the same reason: nothing that can fail belongs inside a transaction that
 * repairs `sessions.currentLeafId`.
 */
export const orphanAgentRunMessages = async (
  messageIds: number[]
): Promise<void> => {
  const batches = messageIdBatches(messageIds, 4)
  if (batches.length === 0) return
  for (const batch of batches) {
    const slots = batch.map(() => "?").join(", ")
    await runWithMeta(
      `UPDATE agent_runs
          SET requestMessageId =
                CASE WHEN requestMessageId IN (${slots}) THEN NULL
                     ELSE requestMessageId END,
              resultMessageId =
                CASE WHEN resultMessageId IN (${slots}) THEN NULL
                     ELSE resultMessageId END
        WHERE requestMessageId IN (${slots}) OR resultMessageId IN (${slots})`,
      [...batch, ...batch, ...batch, ...batch]
    )
  }
  await flushSave()
}

/**
 * Delete the settled runs of a chat, receipts included.
 *
 * The opposite answer to the one above, and deliberately: deleting a branch
 * prunes a conversation, while deleting the chat is the user asking for it to
 * be gone. In a product whose whole claim is that nothing leaves the device,
 * a browsing record that outlives the conversation it belongs to is the wrong
 * default. `agent_steps` cascades from `agent_runs`.
 *
 * Settled only, and that is the load-bearing word. A run that did not stop is
 * still attached to a browser tab and still acting; deleting its row would
 * take away the one handle startup recovery has for settling it, leaving an
 * agent running that nothing can reach. Its row stays until it is terminal,
 * and the sweep below collects it once it is.
 */
export const deleteSettledAgentRunsForSession = async (
  sessionId: string
): Promise<number> => {
  const result = await runWithMeta(
    `DELETE FROM agent_runs
      WHERE sessionId = ?
        AND status IN (${TERMINAL_AGENT_STATUSES.map(() => "?").join(", ")})`,
    [sessionId, ...TERMINAL_AGENT_STATUSES]
  )
  await flushSave()
  return result.changes
}

/**
 * Runs whose chat is gone.
 *
 * The delete that removed the chat tells the background directly, and that is
 * the path that stops a run while it is still driving something. This is the
 * answer for the message that was never delivered — a worker asleep, a page
 * closed mid-delete — and it is read at startup, where the runs are no longer
 * driving anything and settling them is safe.
 */
export const listAgentRunsForMissingSessions = async (): Promise<
  DurableAgentRun[]
> => {
  const rows = await query(
    `SELECT ${selectRunColumns} FROM agent_runs
      WHERE sessionId IS NOT NULL
        AND sessionId NOT IN (SELECT id FROM sessions)
      ORDER BY createdAt ASC`
  )
  return rows.flatMap((value) => {
    const row = decodeRow(AgentRunRowSchema, value, TABLE)
    const parsed = row ? parseRun(row) : null
    return parsed ? [parsed] : []
  })
}

/**
 * Repair rows a worker died between.
 *
 * Two idempotent statements, run once at startup, for the two states the
 * atomic writes above cannot cover on their own: a worker lost after the run
 * settled but before its message did, and a message deleted while its run row
 * still points at it. Neither can be noticed later by the code that made them
 * — both are gaps, and a gap has nobody to report it.
 *
 * A live run is not cancelled here. A run that is still driving a browser is
 * holding this worker alive, so the conversation that deleted its rows told
 * the worker directly; startup is the wrong place to look for it, and
 * cancelling a run because a card is missing would be worse than showing one
 * that has none.
 */
export const reconcileAgentRunLinkage = async (
  signal?: AbortSignal
): Promise<void> => {
  signal?.throwIfAborted()
  const now = Date.now()
  await withTransaction(async (tx) => {
    /**
     * Only rows a run was given its own turn for. A delegated run has no
     * request row, and the row it reports into is its turn's to finish.
     */
    await tx.run(
      `UPDATE messages SET done = 1, updatedAt = ?
        WHERE done = 0
          AND id IN (
            SELECT resultMessageId FROM agent_runs
             WHERE resultMessageId IS NOT NULL
               AND requestMessageId IS NOT NULL
               AND status IN (${TERMINAL_AGENT_STATUSES.map(() => "?").join(", ")})
          )`,
      [now, ...TERMINAL_AGENT_STATUSES]
    )
    /*
     * A run left behind because it would not stop while its chat was being
     * deleted. Recovery settles it earlier in this same startup; collecting it
     * here is what finally honours the delete, and doing it after the settle
     * rather than during it is why a live agent is never left unreachable.
     */
    await tx.run(
      `DELETE FROM agent_runs
        WHERE sessionId IS NOT NULL
          AND sessionId NOT IN (SELECT id FROM sessions)
          AND status IN (${TERMINAL_AGENT_STATUSES.map(() => "?").join(", ")})`,
      [...TERMINAL_AGENT_STATUSES]
    )
    await tx.run(
      `UPDATE agent_runs
          SET requestMessageId =
                CASE WHEN requestMessageId IN (SELECT id FROM messages)
                     THEN requestMessageId ELSE NULL END,
              resultMessageId =
                CASE WHEN resultMessageId IN (SELECT id FROM messages)
                     THEN resultMessageId ELSE NULL END
        WHERE (requestMessageId IS NOT NULL
                 AND requestMessageId NOT IN (SELECT id FROM messages))
           OR (resultMessageId IS NOT NULL
                 AND resultMessageId NOT IN (SELECT id FROM messages))`
    )
    await writeMissingHandoffs(tx)
  })
  await flushSave()
  signal?.throwIfAborted()
}

/**
 * A handoff for every settled run whose row has none: runs settled before
 * handoffs existed, and a settle whose row something else had already
 * finished. Only those rows are read, so a profile where every row has its
 * handoff pays one indexed lookup and nothing more.
 */
const writeMissingHandoffs = async (
  tx: Pick<SqlExecutor, "run" | "query">
): Promise<void> => {
  const rows = await tx.query(
    `SELECT ${selectRunColumns} FROM agent_runs
      WHERE resultMessageId IS NOT NULL
        AND status IN (${TERMINAL_AGENT_STATUSES.map(() => "?").join(", ")})
        AND resultMessageId IN (
          SELECT id FROM messages WHERE agentHandoff IS NULL
        )`,
    [...TERMINAL_AGENT_STATUSES]
  )
  for (const row of decodeRows(AgentRunRowSchema, rows, TABLE)) {
    const run = parseRun(row)
    if (!run?.state || run.resultMessageId === undefined) continue
    const handoff = buildAgentConversationHandoff(
      run.state,
      await listRunFindings(tx, run.id)
    )
    if (!handoff) continue
    await tx.run(
      "UPDATE messages SET agentHandoff = ? WHERE id = ? AND agentHandoff IS NULL",
      [JSON.stringify(handoff), run.resultMessageId]
    )
  }
}

export const createAgentPersistencePort = (): AgentPersistencePort => ({
  claim: claimAgentRunPhase,
  appendStep: appendAgentStep,
  transition: transitionAgentRun,
  async load(runId) {
    return (await getAgentRun(runId))?.state
  },
  steps: listCompleteAgentSteps
})

export const createInitialAgentDeadline = (now: number) =>
  AgentDeadlineStateSchema.parse({
    runStartedAt: now,
    stepStartedAt: now,
    runSuspendedMs: 0,
    stepSuspendedMs: 0
  })
