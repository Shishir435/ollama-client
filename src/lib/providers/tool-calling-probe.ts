import { logger } from "@/lib/logger"
import type { ToolCall } from "@/lib/tools"
import type { LLMProvider } from "./types"

export type ToolCallingMode = "native" | "native-user-results"

export interface ToolCallingProbeResult {
  toolCalling: boolean
  toolCallingMode?: ToolCallingMode
  probedAt: number
}

const PROBE_TIMEOUT_MS = 30_000

const createProbeAbortScope = (externalSignal?: AbortSignal) => {
  const controller = new AbortController()
  const abortFromCaller = () => controller.abort(externalSignal?.reason)
  if (externalSignal?.aborted) abortFromCaller()
  else
    externalSignal?.addEventListener("abort", abortFromCaller, { once: true })
  const timeout = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS)
  return {
    signal: controller.signal,
    cleanup: () => {
      clearTimeout(timeout)
      externalSignal?.removeEventListener("abort", abortFromCaller)
    }
  }
}

const PROBE_TOOL = {
  name: "ping",
  description:
    "Test tool. When asked to verify tool support, call this with value set to 'pong'.",
  parameters: {
    type: "object" as const,
    properties: {
      value: { type: "string", description: "Echo value" }
    },
    required: ["value"]
  }
}

/**
 * Run a complete native tool-call round trip without accessing extension state.
 * Prefer the standard `tool` role, then try an alternating user-result message
 * for llama.cpp templates that reject consecutive assistant/tool roles.
 */
export const runToolCallingProbe = async (
  provider: LLMProvider,
  modelName: string,
  externalSignal?: AbortSignal
): Promise<ToolCallingProbeResult> => {
  const scope = createProbeAbortScope(externalSignal)
  const probePrompt =
    "Call the ping tool with value 'pong' to verify tool support. Do not answer in text."
  let probeCall: ToolCall | undefined
  let streamError: string | undefined

  try {
    await provider.streamChat(
      {
        model: modelName,
        messages: [{ role: "user", content: probePrompt }],
        tools: [PROBE_TOOL],
        think: false,
        num_predict: 256
      },
      (chunk) => {
        if (chunk.error) {
          streamError = chunk.error.message || "Probe request failed"
        }
        if (!probeCall && chunk.toolCalls && chunk.toolCalls.length > 0) {
          probeCall = chunk.toolCalls[0]
        }
      },
      scope.signal
    )
  } catch (error) {
    logger.debug("Tool-calling probe request failed", "capabilityProbe", {
      model: modelName,
      error
    })
    scope.cleanup()
    throw error
  }

  if (streamError) {
    scope.cleanup()
    throw new Error(streamError)
  }
  if (!probeCall) {
    scope.cleanup()
    return { toolCalling: false, probedAt: Date.now() }
  }

  let standardFollowUpFailed = false
  try {
    await provider.streamChat(
      {
        model: modelName,
        messages: [
          { role: "user", content: probePrompt },
          { role: "assistant", content: "", toolCalls: [probeCall] },
          {
            role: "tool",
            content: '{"value":"pong"}',
            toolName: probeCall.name,
            toolCallId: probeCall.id
          }
        ],
        tools: [PROBE_TOOL],
        tool_choice: "none",
        think: false,
        num_predict: 32
      },
      (chunk) => {
        if (chunk.error) {
          streamError = chunk.error.message || "Probe follow-up failed"
        }
      },
      scope.signal
    )
  } catch (error) {
    logger.debug(
      "Tool-calling probe follow-up is incompatible",
      "capabilityProbe",
      { model: modelName, error }
    )
    standardFollowUpFailed = true
  }

  if (!standardFollowUpFailed && !streamError) {
    scope.cleanup()
    return {
      toolCalling: true,
      toolCallingMode: "native",
      probedAt: Date.now()
    }
  }

  if (scope.signal.aborted) {
    scope.cleanup()
    scope.signal.throwIfAborted()
  }

  streamError = undefined
  try {
    await provider.streamChat(
      {
        model: modelName,
        messages: [
          { role: "user", content: probePrompt },
          { role: "assistant", content: "", toolCalls: [probeCall] },
          {
            role: "user",
            content:
              "Tool result for ping (call id: " +
              `${probeCall.id}):\n{"value":"pong"}\n` +
              "Use this result to finish the original request."
          }
        ],
        tools: [PROBE_TOOL],
        tool_choice: "none",
        think: false,
        num_predict: 32
      },
      (chunk) => {
        if (chunk.error) {
          streamError = chunk.error.message || "Probe follow-up failed"
        }
      },
      scope.signal
    )
  } catch (error) {
    if (scope.signal.aborted) scope.signal.throwIfAborted()
    logger.debug(
      "Tool-calling alternating-role follow-up is incompatible",
      "capabilityProbe",
      { model: modelName, error }
    )
    return { toolCalling: false, probedAt: Date.now() }
  } finally {
    scope.cleanup()
  }

  return streamError
    ? { toolCalling: false, probedAt: Date.now() }
    : {
        toolCalling: true,
        toolCallingMode: "native-user-results",
        probedAt: Date.now()
      }
}
