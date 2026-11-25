import type { Role } from "@/types"

/**
 * Pure pieces of keyword chat search: turning what the user typed into a safe
 * query, and turning a highlighted excerpt into segments the UI can render
 * without ever treating message text as markup.
 */

export const MESSAGE_SEARCH_DEFAULT_LIMIT = 30
export const MESSAGE_SEARCH_MAX_LIMIT = 100
/**
 * The scan fallback reads only this many of the newest searchable messages, so
 * a build without FTS5 stays responsive on a very large history.
 */
export const MESSAGE_SCAN_WINDOW = 20_000

const MAX_TERMS = 8
const MAX_TERM_CHARS = 64
export const MIN_SEARCH_CHARS = 2

/** Private-use characters that bracket a match inside an excerpt. */
export const HIGHLIGHT_OPEN = ""
export const HIGHLIGHT_CLOSE = ""

export interface MessageSearchSnippetPart {
  text: string
  match: boolean
}

export interface MessageSearchHit {
  sessionId: string
  messageId: number
  role: Role
  timestamp: number
  snippet: MessageSearchSnippetPart[]
}

/**
 * Words of a query, as the index tokenizer would see them: runs of letters,
 * digits and combining marks. Everything else — quotes, `*`, `-`, `:`, `NEAR` —
 * is a separator here, so none of it can reach FTS5 as query syntax.
 */
export const searchTerms = (input: string): string[] => {
  const terms = input.match(/[\p{L}\p{N}\p{M}]+/gu) ?? []
  return terms.slice(0, MAX_TERMS).map((term) => term.slice(0, MAX_TERM_CHARS))
}

/**
 * An FTS5 `MATCH` expression: every word must appear, and the last one also
 * matches as a prefix so results follow the user's typing. `null` when the
 * input has nothing searchable.
 */
export const buildFtsMatch = (terms: readonly string[]): string | null => {
  if (terms.length === 0) return null
  return terms
    .map((term, index) =>
      index === terms.length - 1 ? `"${term}"*` : `"${term}"`
    )
    .join(" ")
}

/** `LIKE` pattern for one term; `\` is the escape character. */
export const likePattern = (term: string): string =>
  `%${term.replace(/[\\%_]/g, (char) => `\\${char}`)}%`

/** Split an excerpt bracketed with the highlight characters into parts. */
export const parseHighlightedSnippet = (
  raw: string
): MessageSearchSnippetPart[] => {
  const parts: MessageSearchSnippetPart[] = []
  let match = false
  let buffer = ""
  const flush = () => {
    if (buffer) parts.push({ text: buffer, match })
    buffer = ""
  }
  for (const char of raw) {
    if (char === HIGHLIGHT_OPEN) {
      flush()
      match = true
    } else if (char === HIGHLIGHT_CLOSE) {
      flush()
      match = false
    } else {
      buffer += char
    }
  }
  flush()
  return parts
}

/** Mark every occurrence of any term in a plain excerpt (scan fallback). */
export const highlightTerms = (
  excerpt: string,
  terms: readonly string[]
): MessageSearchSnippetPart[] => {
  const lowered = excerpt.toLowerCase()
  const ranges: Array<[number, number]> = []
  for (const term of terms) {
    const needle = term.toLowerCase()
    if (!needle) continue
    let from = 0
    for (;;) {
      const at = lowered.indexOf(needle, from)
      if (at < 0) break
      ranges.push([at, at + needle.length])
      from = at + needle.length
    }
  }
  ranges.sort((a, b) => a[0] - b[0])
  const merged: Array<[number, number]> = []
  for (const range of ranges) {
    const last = merged[merged.length - 1]
    if (last && range[0] <= last[1]) last[1] = Math.max(last[1], range[1])
    else merged.push([...range])
  }
  const parts: MessageSearchSnippetPart[] = []
  let cursor = 0
  for (const [start, end] of merged) {
    if (start > cursor) {
      parts.push({ text: excerpt.slice(cursor, start), match: false })
    }
    parts.push({ text: excerpt.slice(start, end), match: true })
    cursor = end
  }
  if (cursor < excerpt.length) {
    parts.push({ text: excerpt.slice(cursor), match: false })
  }
  return parts
}
