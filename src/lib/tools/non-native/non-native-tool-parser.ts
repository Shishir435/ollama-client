/**
 * Extractor for the non-native tool-call protocol (see
 * `non-native-tool-protocol.ts`). Given the accumulated plain-text output of one
 * model turn, it pulls out every `<tool_call>{json}</tool_call>` block, parses
 * it into the same normalized `ToolCall` shape the native path produces, and
 * returns the user-visible text with those blocks removed.
 *
 * It is deliberately forgiving of the mistakes local models make: an optional
 * markdown fence inside the block, and non-object / malformed arguments (dropped
 * to `{}` rather than throwing). Malformed blocks are skipped, not fatal.
 */
import type { ToolCall } from "../types"

// Non-greedy so adjacent blocks don't merge; `[\s\S]` to span newlines.
// Built fresh per use: a shared `g`-flagged regex carries mutable `lastIndex`
// state across calls, which is easy to break when extending these functions.
const toolCallPattern = () => /<tool_call>\s*([\s\S]*?)\s*<\/tool_call>/g
const CODE_FENCE_PATTERN = /^```(?:json)?\s*([\s\S]*?)\s*```$/

export interface NonNativeParseResult {
  /** Normalized tool calls in document order (empty when none/all malformed). */
  toolCalls: ToolCall[]
  /** The turn text with all `<tool_call>` blocks stripped, trimmed. */
  cleanedText: string
}

const parseBlockBody = (
  raw: string
): { name?: unknown; arguments?: unknown } | null => {
  let text = raw.trim()
  const fenced = CODE_FENCE_PATTERN.exec(text)
  if (fenced?.[1]) text = fenced[1].trim()
  try {
    const value = JSON.parse(text)
    return value && typeof value === "object" && !Array.isArray(value)
      ? (value as { name?: unknown; arguments?: unknown })
      : null
  } catch {
    return null
  }
}

const toArguments = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}

/**
 * Returns true if the text contains at least one complete `<tool_call>` block —
 * a cheap pre-check so the loop can decide whether to parse.
 */
export const hasNonNativeToolCall = (text: string): boolean =>
  toolCallPattern().test(text)

export const parseNonNativeToolCalls = (text: string): NonNativeParseResult => {
  const toolCalls: ToolCall[] = []
  let index = 0

  for (const match of text.matchAll(toolCallPattern())) {
    const parsed = parseBlockBody(match[1] ?? "")
    if (
      !parsed ||
      typeof parsed.name !== "string" ||
      parsed.name.length === 0
    ) {
      continue
    }
    toolCalls.push({
      id: `${parsed.name}_${index}`,
      name: parsed.name,
      arguments: toArguments(parsed.arguments)
    })
    index++
  }

  const cleanedText = text.replace(toolCallPattern(), "").trim()
  return { toolCalls, cleanedText }
}
