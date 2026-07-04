import { useCallback, useEffect, useState } from "react"
import { runtime } from "@/lib/browser-api"
import { MESSAGE_KEYS } from "@/lib/constants"
import type { AgentRun } from "@/lib/repositories/agent-runs"
import type { AgentResumeDescriptor } from "@/types/agent"
import type { ChromeResponse } from "@/types/messaging"

interface AgentControlData {
  run: AgentRun | null
  resume?: AgentResumeDescriptor
}

const request = async (
  type: string,
  payload?: Record<string, unknown>
): Promise<AgentControlData> => {
  const response = (await runtime.sendMessage({
    type,
    payload
  })) as ChromeResponse
  if (!response.success) {
    throw new Error(response.error?.message || "Agent control failed.")
  }
  return response.data as AgentControlData
}

export const useAgentRun = (
  sessionId: string | null,
  onResume: (resume: AgentResumeDescriptor) => void
) => {
  const [run, setRun] = useState<AgentRun | null>(null)
  const [error, setError] = useState<string>()

  const refresh = useCallback(async () => {
    try {
      const data = await request(MESSAGE_KEYS.APP.AGENT_GET_CURRENT, {
        sessionId
      })
      setRun(data.run)
      setError(undefined)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }, [sessionId])

  useEffect(() => {
    void refresh()
    const interval = window.setInterval(() => void refresh(), 1_000)
    return () => window.clearInterval(interval)
  }, [refresh])

  useEffect(() => {
    if (run?.status !== "running" && run?.status !== "awaiting-approval") {
      return
    }
    const heartbeat = () => {
      void runtime
        .sendMessage({ type: MESSAGE_KEYS.APP.KEEP_TOOL_LOOP_ALIVE })
        .catch(() => undefined)
    }
    heartbeat()
    const interval = window.setInterval(heartbeat, 20_000)
    return () => window.clearInterval(interval)
  }, [run?.status])

  const control = async (
    type: string,
    options?: { resume?: boolean }
  ): Promise<void> => {
    if (!run) return
    try {
      const data = await request(type, { requestId: run.id })
      setRun(data.run)
      setError(undefined)
      if (options?.resume && data.resume) onResume(data.resume)
    } catch (cause) {
      if (options?.resume) {
        await request(MESSAGE_KEYS.APP.AGENT_PAUSE, {
          requestId: run.id
        }).catch(() => undefined)
      }
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }

  return {
    run,
    error,
    refresh,
    pause: () => control(MESSAGE_KEYS.APP.AGENT_PAUSE),
    resume: () =>
      control(MESSAGE_KEYS.APP.AGENT_RESUME, {
        resume: true
      }),
    stop: () => control(MESSAGE_KEYS.APP.AGENT_STOP)
  }
}
