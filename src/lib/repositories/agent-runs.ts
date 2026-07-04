import { flushSave, query, run } from "@/lib/sqlite/db"
import type { AgentRunState, AgentRunStatus } from "@/types/agent"

export const AGENT_MAX_MODEL_TURNS = 25
export const AGENT_MAX_ACTIONS = 15
export const AGENT_MAX_ACTIVE_MS = 15 * 60 * 1000

export interface AgentRun {
  id: string
  sessionId: string
  status: AgentRunStatus
  state: AgentRunState
  createdAt: number
  updatedAt: number
  completedAt?: number
}

interface AgentRunRow {
  id: string
  sessionId: string
  status: string
  state: string
  createdAt: number
  updatedAt: number
  completedAt: number | null
}

const STATUSES = new Set<AgentRunStatus>([
  "running",
  "awaiting-approval",
  "paused",
  "completed",
  "failed",
  "cancelled",
  "capped"
])

const parse = (row: AgentRunRow): AgentRun | null => {
  try {
    if (!STATUSES.has(row.status as AgentRunStatus)) return null
    return {
      id: row.id,
      sessionId: row.sessionId,
      status: row.status as AgentRunStatus,
      state: JSON.parse(row.state) as AgentRunState,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      completedAt: row.completedAt ?? undefined
    }
  } catch {
    return null
  }
}

export const getAgentRun = async (id: string): Promise<AgentRun | null> => {
  const rows = (await query(
    "SELECT id, sessionId, status, state, createdAt, updatedAt, completedAt FROM agent_runs WHERE id = ?",
    [id]
  )) as unknown as AgentRunRow[]
  return rows[0] ? parse(rows[0]) : null
}

export const getAgentRunsForSession = async (
  sessionId: string
): Promise<AgentRun[]> => {
  const rows = (await query(
    "SELECT id, sessionId, status, state, createdAt, updatedAt, completedAt FROM agent_runs WHERE sessionId = ? ORDER BY createdAt DESC",
    [sessionId]
  )) as unknown as AgentRunRow[]
  return rows.map(parse).filter((value): value is AgentRun => value !== null)
}

export const getActiveAgentRun = async (): Promise<AgentRun | null> => {
  const rows = (await query(
    "SELECT id, sessionId, status, state, createdAt, updatedAt, completedAt FROM agent_runs WHERE status IN ('running', 'awaiting-approval') ORDER BY updatedAt DESC LIMIT 1"
  )) as unknown as AgentRunRow[]
  return rows[0] ? parse(rows[0]) : null
}

export const saveAgentRun = async (value: AgentRun): Promise<void> => {
  await run(
    `INSERT INTO agent_runs
      (id, sessionId, status, state, createdAt, updatedAt, completedAt)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       status = excluded.status,
       state = excluded.state,
       updatedAt = excluded.updatedAt,
       completedAt = excluded.completedAt`,
    [
      value.id,
      value.sessionId,
      value.status,
      JSON.stringify(value.state),
      value.createdAt,
      value.updatedAt,
      value.completedAt ?? null
    ]
  )
  await flushSave()
}

export const pauseInterruptedAgentRuns = async (): Promise<void> => {
  await run(
    "UPDATE agent_runs SET status = 'paused', updatedAt = ? WHERE status IN ('running', 'awaiting-approval')",
    [Date.now()]
  )
  await flushSave()
}

export const agentRunCapReason = (state: AgentRunState): string | undefined => {
  if (state.stopReason) return state.stopReason
  if (state.modelTurns >= AGENT_MAX_MODEL_TURNS) return "model-turn limit"
  if (state.actionCount >= AGENT_MAX_ACTIONS) return "page-action limit"
  if (state.activeMs >= AGENT_MAX_ACTIVE_MS) return "active-time limit"
  return undefined
}

export const finalAgentRunStatus = (
  capReason: string | undefined,
  aborted: boolean
): AgentRunStatus =>
  capReason ? "capped" : aborted ? "cancelled" : "completed"
