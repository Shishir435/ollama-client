import {
  getAgentRun,
  getLatestAgentRun,
  listAgentSteps
} from "@/lib/repositories/agent-runs"

/**
 * One run's durable record, as a developer needs to read it.
 *
 * A panel shows a run; it does not let anyone hand that run to someone else.
 * Diagnosing a failure meant screenshotting the work log and reading statuses
 * off the picture, which loses the command's own fields, the verification
 * summaries under the fold, and the error's code — the three things that
 * actually say where a run went wrong.
 *
 * This is the table, not a second account of it: whatever `agent_runs` and
 * `agent_steps` hold is what comes out. Sensitive command values were already
 * redacted where each step was written, so the record carries no secret that
 * the panel would not also show. It does carry page-derived text — a
 * verification summary quotes the page — which is the point and is also why
 * this exists only in a development build.
 */
export interface AgentDebugReport {
  runId: string
  goal: string
  status: string
  error?: { code: string; message: string }
  observations?: number
  model?: string
  provider?: string
  startedAt: string
  steps: {
    sequence: number
    status: string
    command?: string
    detail?: Record<string, unknown>
    risk?: string
    outcome?: string
    evidence?: string
    url?: string
  }[]
}

const commandDetail = (
  command: Record<string, unknown> | undefined
): Record<string, unknown> | undefined => {
  if (!command) return undefined
  const { type: _type, snapshotId: _snapshotId, ...rest } = command
  return Object.keys(rest).length > 0 ? rest : undefined
}

export const buildAgentDebugReport = async (
  runId?: string
): Promise<AgentDebugReport | undefined> => {
  const run = runId ? await getAgentRun(runId) : await getLatestAgentRun()
  if (!run) return undefined
  const steps = await listAgentSteps(run.id)
  const state = run.state
  return {
    runId: run.id,
    goal: state?.goal ?? "",
    status: run.status,
    ...(state?.error ? { error: state.error } : {}),
    ...(state?.observationCount === undefined
      ? {}
      : { observations: state.observationCount }),
    ...(state?.modelId ? { model: state.modelId } : {}),
    ...(state?.providerId ? { provider: state.providerId } : {}),
    startedAt: new Date(run.createdAt).toISOString(),
    steps: steps.map((step) => ({
      sequence: step.sequence,
      status: step.status,
      ...(step.command ? { command: step.command.type } : {}),
      ...(commandDetail(step.command as Record<string, unknown> | undefined)
        ? {
            detail: commandDetail(
              step.command as Record<string, unknown> | undefined
            )
          }
        : {}),
      ...(step.risk ? { risk: step.risk } : {}),
      ...(step.verification ? { outcome: step.verification.outcome } : {}),
      ...(step.verification?.evidence.summary
        ? { evidence: step.verification.evidence.summary }
        : {}),
      ...(step.sourceUrl ? { url: step.sourceUrl } : {})
    }))
  }
}

/**
 * Installed on the worker's own global so it is reachable from the background
 * DevTools console with no build step and no UI:
 *
 *   await __agentReport()          // the run that ran last
 *   await __agentReport("run-id")  // a particular one
 *   copy(await __agentReport())    // straight to the clipboard
 *
 * It returns the JSON string rather than the object because the object prints
 * as a collapsed tree that cannot be copied whole, and a run's record is
 * meant to be pasted somewhere.
 */
export const installAgentDebugReport = (): void => {
  const scope = globalThis as typeof globalThis & {
    __agentReport?: (runId?: string) => Promise<string>
  }
  scope.__agentReport = async (target?: string) => {
    const report = await buildAgentDebugReport(target)
    return report
      ? JSON.stringify(report, null, 2)
      : JSON.stringify({ error: "No agent run found" })
  }
}
