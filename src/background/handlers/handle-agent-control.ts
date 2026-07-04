import { abortAndClearController } from "@/background/lib/abort-controller-registry"
import { setAgentControlIntent } from "@/background/lib/agent-control-registry"
import { browser } from "@/lib/browser-api"
import { MESSAGE_KEYS } from "@/lib/constants"
import {
  getAgentRun,
  getCurrentAgentRun,
  getLatestAgentRunForSession,
  saveAgentRun
} from "@/lib/repositories/agent-runs"
import {
  deleteToolLoopRun,
  getToolLoopRun
} from "@/lib/repositories/tool-loop-runs"
import type { AgentResumeDescriptor } from "@/types/agent"

const clearHighlight = async (tabId: number): Promise<void> => {
  await browser.tabs
    .sendMessage(tabId, {
      type: MESSAGE_KEYS.BROWSER.AGENT_CLEAR_HIGHLIGHT
    })
    .catch(() => undefined)
}

const requireRun = async (requestId: string) => {
  const run = await getAgentRun(requestId)
  if (!run) throw new Error("Agent run was not found.")
  return run
}

export const getCurrentAgentControlState = async (sessionId?: string) => {
  const run =
    (await getCurrentAgentRun()) ??
    (sessionId ? await getLatestAgentRunForSession(sessionId) : null)
  return { run }
}

export const pauseAgentRun = async (requestId: string) => {
  const run = await requireRun(requestId)
  if (run.status !== "running" && run.status !== "awaiting-approval") {
    return { run }
  }

  setAgentControlIntent(requestId, "pause")
  run.status = "paused"
  run.updatedAt = Date.now()
  run.completedAt = undefined
  await saveAgentRun(run)
  abortAndClearController(requestId)
  await clearHighlight(run.state.targetTabId)
  return { run }
}

export const stopAgentRun = async (requestId: string) => {
  const run = await requireRun(requestId)
  setAgentControlIntent(requestId, "stop")
  abortAndClearController(requestId)
  run.status = "cancelled"
  run.state.pendingAction = undefined
  run.state.stopReason = "Stopped by user"
  run.updatedAt = Date.now()
  run.completedAt = run.updatedAt
  await saveAgentRun(run)
  await deleteToolLoopRun(requestId)
  await clearHighlight(run.state.targetTabId)
  return { run }
}

export const resumeAgentRun = async (
  requestId: string
): Promise<{
  run: Awaited<ReturnType<typeof requireRun>>
  resume: AgentResumeDescriptor
}> => {
  const run = await requireRun(requestId)
  if (run.status !== "paused") {
    throw new Error("Only a paused agent run can be resumed.")
  }
  const current = await getCurrentAgentRun()
  if (current && current.id !== requestId) {
    throw new Error("Another browser-agent run must be stopped first.")
  }
  const checkpoint = await getToolLoopRun(requestId)
  if (!checkpoint) {
    throw new Error("Agent checkpoint is unavailable; start a new run.")
  }

  run.status = "running"
  run.completedAt = undefined
  run.updatedAt = Date.now()
  await saveAgentRun(run)
  return {
    run,
    resume: {
      requestId,
      sessionId: run.sessionId,
      model: checkpoint.model,
      providerId: checkpoint.providerId
    }
  }
}
