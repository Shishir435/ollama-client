/**
 * Translation between the OpenAI chat-completions wire format the client speaks and
 * the session/prompt shape OpenCode expects.
 *
 * Note: OpenCode has no notion of an OpenAI tool turn. A tool exchange this proxy
 * is still driving is resolved through the pending-call registry, but an exchange
 * replayed from the client's history belongs to a session OpenCode no longer has,
 * so it is rendered as transcript text — dropping it would hide the fact that a
 * tool ran at all.
 */
import type {
  OpenAIMessage,
  OpenAIToolCall,
  PendingToolCall,
  ToolResultMessage
} from "../types.js"
import { isRecord } from "../util.js"

export interface PromptPart {
  type: "text"
  text: string
}

/** Collapse the several shapes an OpenAI `content` field takes into text. */
export const normalizeMessageContent = (content: unknown): string => {
  if (typeof content === "string") return content
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") return part
        if (isRecord(part) && typeof part.text === "string") return part.text
        return ""
      })
      .join("")
  }
  if (isRecord(content) && typeof content.text === "string") return content.text
  if (typeof content === "number" || typeof content === "boolean") {
    return String(content)
  }
  return ""
}

const describeToolCall = (call: OpenAIToolCall): string => {
  const name =
    isRecord(call.function) && typeof call.function.name === "string"
      ? call.function.name
      : "tool"
  const args =
    isRecord(call.function) && typeof call.function.arguments === "string"
      ? call.function.arguments
      : "{}"
  return `${name}(${args})`
}

/**
 * Turn the client's message list into OpenCode prompt parts.
 *
 * `system` chunks are hoisted out because OpenCode takes them as a separate field;
 * everything else keeps its role prefix so the model can tell turns apart in a
 * single flattened prompt.
 */
export const buildPromptParts = (
  messages: unknown
): { parts: PromptPart[]; system: string; lastUserMsg: string } => {
  const parts: PromptPart[] = []
  const systemChunks: string[] = []
  const userContents: string[] = []
  const toolNames = new Map<string, string>()
  const list: OpenAIMessage[] = Array.isArray(messages) ? messages : []

  for (const message of list) {
    const role = String(message?.role || "user").toLowerCase()
    const content = normalizeMessageContent(message?.content)

    if (role === "system") {
      if (content) systemChunks.push(content)
      continue
    }

    if (role === "assistant") {
      const calls = Array.isArray(message.tool_calls) ? message.tool_calls : []
      for (const call of calls) {
        if (typeof call?.id !== "string") continue
        const name = isRecord(call.function) ? call.function.name : undefined
        if (typeof name === "string") toolNames.set(call.id, name)
      }
      if (calls.length > 0) {
        const rendered = calls.map(describeToolCall).join(", ")
        parts.push({
          type: "text",
          text: `ASSISTANT: [called tools] ${rendered}${content ? `\n${content}` : ""}`
        })
        continue
      }
    }

    if (role === "tool") {
      const name =
        (message.tool_call_id && toolNames.get(message.tool_call_id)) || "tool"
      parts.push({ type: "text", text: `TOOL RESULT (${name}): ${content}` })
      continue
    }

    if (!content) continue
    if (role === "user") userContents.push(content)
    const nameSuffix = message?.name ? `(${message.name})` : ""
    parts.push({
      type: "text",
      text: `${role.toUpperCase()}${nameSuffix}: ${content}`
    })
  }

  return {
    parts,
    system: systemChunks.join("\n\n"),
    lastUserMsg: userContents[userContents.length - 1] || ""
  }
}

/**
 * The `tool` messages that close the tail of a request, in order.
 *
 * Only the tail counts: those are the results for the tool calls this proxy just
 * emitted, and matching them by id is what lets a suspended OpenCode turn resume
 * instead of being replayed as a fresh session.
 */
export const extractTrailingToolResults = (
  messages: unknown
): ToolResultMessage[] => {
  const list: OpenAIMessage[] = Array.isArray(messages) ? messages : []
  const results: ToolResultMessage[] = []

  for (let index = list.length - 1; index >= 0; index -= 1) {
    const message = list[index] as OpenAIMessage | undefined
    const role = String(message?.role || "").toLowerCase()
    if (role !== "tool") break
    if (typeof message?.tool_call_id !== "string") break
    results.unshift({
      toolCallId: message.tool_call_id,
      content: normalizeMessageContent(message.content)
    })
  }

  return results
}

/**
 * Which tools OpenCode may use for one turn.
 *
 * Every id OpenCode reports is listed explicitly, so its own file, shell and
 * network tools are off unless the operator allowed them: this proxy serves a
 * client that has its own tool inventory and its own approval flow, and an agent
 * quietly reaching for `bash` instead is neither visible nor wanted there.
 */
export const buildToolFlags = ({
  discoveredIds = [],
  bridgeNames = [],
  allowedNativeTools = []
}: {
  discoveredIds?: string[]
  bridgeNames?: string[]
  allowedNativeTools?: string[]
} = {}): Record<string, boolean> => {
  const allowed = new Set(allowedNativeTools)
  const flags: Record<string, boolean> = {}
  for (const id of discoveredIds) flags[id] = allowed.has(id)
  for (const name of bridgeNames) flags[name] = true
  return flags
}

/** OpenAI `tool_calls` entry for one parked bridge call. */
export const toToolCallPayload = (call: PendingToolCall, index: number) => ({
  index,
  id: call.callId,
  type: "function" as const,
  function: {
    name: call.tool,
    arguments: JSON.stringify(call.args ?? {})
  }
})

const chunk = (
  id: string,
  model: string,
  delta: Record<string, unknown>,
  finishReason: string | null = null
) => ({
  id,
  object: "chat.completion.chunk",
  created: Math.floor(Date.now() / 1000),
  model,
  choices: [{ index: 0, delta, finish_reason: finishReason }]
})

export const roleChunk = (id: string, model: string) =>
  chunk(id, model, { role: "assistant" })

export const contentChunk = (id: string, model: string, content: string) =>
  chunk(id, model, { content })

export const reasoningChunk = (id: string, model: string, reasoning: string) =>
  chunk(id, model, { reasoning_content: reasoning })

export const patchChunk = (id: string, model: string, patches: unknown[]) =>
  chunk(id, model, { patches })

export const toolCallsChunk = (
  id: string,
  model: string,
  calls: PendingToolCall[]
) =>
  chunk(id, model, {
    tool_calls: calls.map((call, index) => toToolCallPayload(call, index))
  })

export const finishChunk = (id: string, model: string, finishReason: string) =>
  chunk(id, model, {}, finishReason)
