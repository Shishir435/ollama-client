import {
  AGENT_STATUS_PREDECESSORS,
  type AgentClaimResult,
  type AgentPersistencePort,
  type AgentPhaseClaim,
  type AgentStatePatch,
  type AgentStepWrite,
  type AgentTransitionResult,
  type AgentTransitionWrite,
  isTerminalAgentStatus
} from "@ollama-client/agent-runtime"
import {
  AgentCommandSchema,
  AgentDeadlineStateSchema,
  type AgentRunState,
  AgentRunStateSchema,
  type AgentRunStatus,
  AgentRunStatusSchema,
  AgentStepStatusSchema
} from "@ollama-client/contracts"
import { z } from "zod"
import { logger } from "@/lib/logger"
import {
  flushSave,
  query,
  runWithMeta,
  type SqlExecutor,
  withTransaction
} from "@/lib/sqlite/db"
import { decodeRow, decodeRows, type RowDecodeContext } from "./row-decoder"

export const MAX_AGENT_CHECKPOINT_BYTES = 64 * 1024
export const MAX_AGENT_STEP_RECEIPT_BYTES = 16 * 1024
export const MAX_AGENT_STEPS = 25
export const TERMINAL_AGENT_RETENTION_MS = 30 * 24 * 60 * 60 * 1000

const TABLE: RowDecodeContext = { table: "agent_runs", operation: "read" }
const STEP_TABLE: RowDecodeContext = { table: "agent_steps", operation: "read" }

const AgentRunRowSchema = z.object({
  id: z.string(),
  status: AgentRunStatusSchema,
  checkpoint: z.string(),
  createdAt: z.number(),
  updatedAt: z.number()
})

const AgentRunIdRowSchema = z.object({ id: z.string() })

const AgentVerificationSchema = z
  .object({
    outcome: z.enum(["confirmed", "negative", "ambiguous"]),
    evidence: z
      .object({
        kind: z.string().max(200),
        summary: z.string().max(2_000),
        observedAt: z.number().int().nonnegative()
      })
      .strict()
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
    risk: z.enum(["low", "medium", "high", "critical"]).optional(),
    verification: AgentVerificationSchema.optional()
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

const AgentCheckpointSchema = z
  .object({ version: z.literal(1), state: AgentRunStateSchema })
  .strict()

const CompactedAgentCheckpointSchema = z
  .object({
    version: z.literal(1),
    compacted: z.literal(true),
    terminalAt: z.number().int().nonnegative()
  })
  .strict()

type AgentRunRow = z.infer<typeof AgentRunRowSchema>

export interface DurableAgentRun {
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

const compactedCheckpoint = (terminalAt: number): string =>
  JSON.stringify({ version: 1, compacted: true, terminalAt })

const parseRun = (row: AgentRunRow): DurableAgentRun | null => {
  try {
    const decoded: unknown = JSON.parse(row.checkpoint)
    const compacted = CompactedAgentCheckpointSchema.safeParse(decoded)
    if (compacted.success) {
      if (!isTerminalAgentStatus(row.status)) return null
      return { ...row, state: undefined, compacted: true }
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

const selectRunColumns = "id, status, checkpoint, createdAt, updatedAt"

export const createAgentRun = async (state: AgentRunState): Promise<void> => {
  if (state.status !== "submitted") {
    throw new Error("A durable agent run must begin in submitted status")
  }
  const checkpoint = serializeCheckpoint(state)
  await runWithMeta(
    `INSERT INTO agent_runs (id, status, checkpoint, createdAt, updatedAt)
     VALUES (?, ?, ?, ?, ?)`,
    [state.id, state.status, checkpoint, state.createdAt, state.updatedAt]
  )
  await flushSave()
}

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

const applyPatch = (
  state: AgentRunState,
  status: AgentRunStatus,
  patch?: AgentStatePatch
): AgentRunState => AgentRunStateSchema.parse({ ...state, ...patch, status })

const appendStepInTransaction = async (
  tx: SqlExecutor,
  input: AgentStepWrite
): Promise<void> => {
  const receipt = AgentStepReceiptSchema.parse({ version: 1, ...input })
  const serialized = serializeBounded(
    receipt,
    MAX_AGENT_STEP_RECEIPT_BYTES,
    "Agent step receipt"
  )
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
      ? compactedCheckpoint(next.updatedAt)
      : serializeCheckpoint(next)
    const placeholders = expected.map(() => "?").join(", ")
    const result = await tx.runWithMeta(
      `UPDATE agent_runs
          SET status = ?, checkpoint = ?, updatedAt = ?
        WHERE id = ? AND status IN (${placeholders})`,
      [target, checkpoint, next.updatedAt, input.runId, ...expected]
    )
    if (result.changes === 0) return

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

export const listAgentSteps = async (
  runId: string
): Promise<DurableAgentStep[]> => {
  const rows = await query(
    `SELECT id, runId, stepId, status, receipt, createdAt
       FROM agent_steps WHERE runId = ? ORDER BY id ASC`,
    [runId]
  )
  const decoded = decodeRows(AgentStepRowSchema, rows, STEP_TABLE)
  const steps: DurableAgentStep[] = []
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
      }
    } catch {
      logger.warn("Refused an unreadable agent step receipt", "AgentRuns", {
        rowId: String(row.id)
      })
    }
  }
  return steps
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
  const result = await runWithMeta(
    `UPDATE agent_runs SET status = 'failed', checkpoint = ?, updatedAt = ?
      WHERE id = ? AND status NOT IN ('completed', 'failed', 'cancelled')`,
    [compactedCheckpoint(now), now, id]
  )
  if (result.changes > 0) await flushSave()
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

export const createAgentPersistencePort = (): AgentPersistencePort => ({
  claim: claimAgentRunPhase,
  appendStep: appendAgentStep,
  transition: transitionAgentRun,
  async load(runId) {
    return (await getAgentRun(runId))?.state
  }
})

export const createInitialAgentDeadline = (now: number) =>
  AgentDeadlineStateSchema.parse({
    runStartedAt: now,
    stepStartedAt: now,
    runSuspendedMs: 0,
    stepSuspendedMs: 0
  })
