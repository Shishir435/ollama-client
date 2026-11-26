import type { PromptTemplate } from "@/types"

/** A slash token the caret sits at the end of, and where it began. */
export interface SlashQuery {
  /** Index of the `/` that opened the menu. */
  start: number
  /** What was typed after it, up to the caret. */
  query: string
}

/** Templates offered at once; the rest are reached by typing more. */
export const SLASH_MENU_LIMIT = 8

/**
 * Whether the position falls inside an unclosed fenced code block. A slash
 * that starts a line in pasted code is code, not a request for a template.
 * As in CommonMark, only a bare fence of the opener's character and at least
 * its length closes the block.
 */
const insideCodeFence = (value: string, position: number): boolean => {
  let open: string | undefined
  for (const line of value.slice(0, position).split("\n")) {
    const fence = /^[ \t]*(`{3,}|~{3,})(.*)$/.exec(line)
    if (!fence) continue
    if (!open) open = fence[1]
    else if (
      fence[1][0] === open[0] &&
      fence[1].length >= open.length &&
      !fence[2].trim()
    )
      open = undefined
  }
  return open !== undefined
}

/**
 * The slash token the caret is at the end of, or null.
 *
 * The menu opens only for a `/` that begins a line, optionally after
 * indentation. A slash in the middle of a word or address (`and/or`,
 * `https://`) is ordinary text, and no whitespace is allowed in the query:
 * a space ends the token and with it the menu.
 */
export const findSlashQuery = (
  value: string,
  caret: number | null
): SlashQuery | null => {
  if (caret === null || caret < 1 || caret > value.length) return null
  /** A caret inside a word (`/sum|marize`) is not at the token's end. */
  if (/\S/.test(value.charAt(caret))) return null
  const lineStart = value.lastIndexOf("\n", caret - 1) + 1
  const beforeCaret = value.slice(lineStart, caret)
  const match = /^([ \t]*)\/(\S*)$/.exec(beforeCaret)
  if (!match) return null
  const start = lineStart + match[1].length
  if (insideCodeFence(value, start)) return null
  return { start, query: match[2] }
}

const rank = (template: PromptTemplate, query: string): number => {
  const title = template.title.toLowerCase()
  if (title.startsWith(query)) return 0
  if (title.includes(query)) return 1
  if (template.tags?.some((tag) => tag.toLowerCase().includes(query))) return 2
  if (template.category?.toLowerCase().includes(query)) return 2
  if (template.description?.toLowerCase().includes(query)) return 3
  return -1
}

/**
 * Templates matching the query, best match first. Within a rank the most
 * used template leads, so the ones a person reaches for are at the top of an
 * empty `/`.
 */
export const filterSlashTemplates = (
  templates: readonly PromptTemplate[],
  query: string,
  limit: number = SLASH_MENU_LIMIT
): PromptTemplate[] => {
  const needle = query.trim().toLowerCase()
  return templates
    .map((template) => ({
      template,
      score: needle ? rank(template, needle) : 0
    }))
    .filter((entry) => entry.score >= 0)
    .sort(
      (a, b) =>
        a.score - b.score ||
        (b.template.usageCount ?? 0) - (a.template.usageCount ?? 0) ||
        a.template.title.localeCompare(b.template.title)
    )
    .slice(0, limit)
    .map((entry) => entry.template)
}

/**
 * The text and caret after a template replaces the slash token. A space is
 * added only when text follows the token directly, so a prompt inserted ahead
 * of more text does not run into it.
 */
export const insertSlashTemplate = (
  value: string,
  { start }: SlashQuery,
  caret: number,
  prompt: string
): { value: string; caret: number } => {
  const after = value.slice(caret)
  const inserted = after && !/^\s/.test(after) ? `${prompt} ` : prompt
  return {
    value: value.slice(0, start) + inserted + after,
    caret: start + inserted.length
  }
}
