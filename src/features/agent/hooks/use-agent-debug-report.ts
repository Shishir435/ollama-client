import {
  AgentPanelCommandSchema,
  AgentPanelMessageSchema
} from "@ollama-client/contracts"
import { useEffect } from "react"

import type { browser } from "@/lib/browser-api"
import { AGENT_DEBUG_REPORT_ENABLED } from "@/lib/feature-flags"

/** Read through the authenticated background boundary, including historical runs. */
export const requestAgentDebugReport = (
  port: ReturnType<typeof browser.runtime.connect>,
  runId?: string,
  signal?: AbortSignal
): Promise<string> => {
  if (!AGENT_DEBUG_REPORT_ENABLED)
    return Promise.reject(new Error("Agent debug reports are disabled"))
  const command = {
    type: "agent_debug_report" as const,
    requestId: crypto.randomUUID(),
    runId
  }
  AgentPanelCommandSchema.parse(command)
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new Error("Agent panel closed"))
    let settled = false
    const finish = (report?: string, error?: Error) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      signal?.removeEventListener("abort", onAbort)
      port.onDisconnect.removeListener(onDisconnect)
      port.onMessage.removeListener(onMessage)
      if (error) reject(error)
      else resolve(report ?? "")
    }
    const onAbort = () => finish(undefined, new Error("Agent panel closed"))
    const onDisconnect = () =>
      finish(undefined, new Error("Agent background disconnected"))
    const onMessage = (raw: unknown) => {
      const parsed = AgentPanelMessageSchema.safeParse(raw)
      if (!parsed.success) return
      const message = parsed.data
      if (
        message.type === "agent_debug_report" &&
        message.requestId === command.requestId
      )
        finish(message.report)
      else if (
        message.type === "agent_command_failed" &&
        message.command === command.type
      )
        finish(undefined, new Error(message.message))
    }
    const timeout = setTimeout(
      () => finish(undefined, new Error("Agent report timed out")),
      30_000
    )
    signal?.addEventListener("abort", onAbort, { once: true })
    port.onMessage.addListener(onMessage)
    port.onDisconnect.addListener(onDisconnect)
    try {
      port.postMessage(command)
    } catch {
      finish(undefined, new Error("Agent report could not be sent"))
    }
  })
}

/** Developer console helper. Durable reads stay owned by the background. */
export type AgentDebugReporter = (
  runId?: string,
  signal?: AbortSignal
) => Promise<string>

export const useAgentDebugReport = (request: AgentDebugReporter): void => {
  useEffect(() => {
    if (!AGENT_DEBUG_REPORT_ENABLED) return
    const controller = new AbortController()
    const scope = globalThis as typeof globalThis & {
      __agentReport?: (runId?: string) => Promise<string>
    }
    scope.__agentReport = (runId) => request(runId, controller.signal)
    return () => {
      controller.abort()
      scope.__agentReport = undefined
    }
  }, [request])
}
