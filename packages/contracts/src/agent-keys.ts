import { z } from "zod"

/**
 * The keys a `press_key` command may name, by their `KeyboardEvent.key` value.
 * Bounded on purpose: a key the table does not know has no key code to
 * dispatch natively, so admitting it would only produce a synthetic event the
 * page can tell from a real one.
 */
export const AGENT_NAMED_KEYS = [
  "Enter",
  "Escape",
  "Tab",
  "Backspace",
  "Delete",
  "Space",
  "ArrowUp",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "Home",
  "End",
  "PageUp",
  "PageDown"
] as const
export type AgentNamedKey = (typeof AGENT_NAMED_KEYS)[number]

export const AGENT_KEY_MODIFIERS = ["Control", "Shift", "Alt", "Meta"] as const
export type AgentKeyModifier = (typeof AGENT_KEY_MODIFIERS)[number]

export const MAX_AGENT_KEY_COMBINATION_CHARS = 40

export interface AgentKeyCombination {
  /** Modifiers in canonical order, each at most once. */
  modifiers: readonly AgentKeyModifier[]
  /** A named key, or one printable character. */
  key: AgentNamedKey | string
}

const isNamedKey = (value: string): value is AgentNamedKey =>
  (AGENT_NAMED_KEYS as readonly string[]).includes(value)

const isModifier = (value: string): value is AgentKeyModifier =>
  (AGENT_KEY_MODIFIERS as readonly string[]).includes(value)

/** One printable, non-space character: a letter, digit or punctuation mark. */
const isPrintableCharacter = (value: string): boolean =>
  [...value].length === 1 && !/[\s\p{C}]/u.test(value)

/**
 * Parses `Modifier+...+Key`, e.g. `Enter`, `Shift+Tab`, `Control+a`.
 *
 * Modifiers are case-sensitive names so `Alt` cannot be confused with a
 * character key; the final token is a named key or a single character. The
 * `+` character itself is spelled as the last token of a combination whose
 * other tokens are modifiers, e.g. `Control++` is not accepted — a plus key is
 * rare enough that ambiguity is not worth carrying.
 */
export const parseAgentKeyCombination = (
  value: string
): AgentKeyCombination | undefined => {
  if (value.length === 0 || value.length > MAX_AGENT_KEY_COMBINATION_CHARS) {
    return undefined
  }
  const tokens = value.split("+")
  const key = tokens.pop()
  if (key === undefined || tokens.some((token) => token.length === 0)) {
    return undefined
  }
  if (!isNamedKey(key) && !isPrintableCharacter(key)) return undefined
  const modifiers: AgentKeyModifier[] = []
  for (const token of tokens) {
    if (!isModifier(token) || modifiers.includes(token)) return undefined
    modifiers.push(token)
  }
  modifiers.sort(
    (first, second) =>
      AGENT_KEY_MODIFIERS.indexOf(first) - AGENT_KEY_MODIFIERS.indexOf(second)
  )
  return { modifiers, key }
}

export const formatAgentKeyCombination = (
  combination: AgentKeyCombination
): string => [...combination.modifiers, combination.key].join("+")

export const AgentKeyCombinationSchema = z
  .string()
  .min(1)
  .max(MAX_AGENT_KEY_COMBINATION_CHARS)
  .refine((value) => parseAgentKeyCombination(value) !== undefined, {
    message:
      "A key is a named key or one character, optionally preceded by Control, Shift, Alt or Meta joined with +"
  })
