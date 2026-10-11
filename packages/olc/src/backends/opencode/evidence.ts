/**
 * What an OpenCode session reports besides its text: token usage and the pages
 * its `websearch` and `webfetch` tools read.
 *
 * Read from the stored session messages rather than the event feed. The feed
 * is one of two paths a leg may settle through, and the stored message is the
 * record both agree on.
 */
import { isRecord } from "../../util.js"
import type { TurnSource, TurnUsage } from "../types.js"

/** Sources sent per answer at most. */
export const MAX_OPENCODE_SOURCES = 8

const count = (value: unknown): number =>
  typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0

const partsOf = (entry: unknown): Record<string, unknown>[] =>
  isRecord(entry) && Array.isArray(entry.parts)
    ? entry.parts.filter(isRecord)
    : []

const isAssistant = (entry: unknown): boolean =>
  isRecord(entry) && isRecord(entry.info) && entry.info.role === "assistant"

/**
 * One OpenCode `tokens` record in OpenAI's terms.
 *
 * OpenCode splits what OpenAI sums: `input` excludes cache reads and writes,
 * and `output` excludes reasoning (`session.ts` `getUsage`). Both are added
 * back so `prompt_tokens` and `completion_tokens` mean what OpenAI means.
 */
const readTokens = (tokens: unknown, cost: unknown): TurnUsage | null => {
  if (!isRecord(tokens)) return null
  const cache = isRecord(tokens.cache) ? tokens.cache : {}
  const cacheRead = count(cache.read)
  const reasoning = count(tokens.reasoning)
  const usage: TurnUsage = {
    promptTokens: count(tokens.input) + cacheRead + count(cache.write),
    completionTokens: count(tokens.output) + reasoning
  }
  if (cacheRead) usage.cachedPromptTokens = cacheRead
  if (reasoning) usage.reasoningTokens = reasoning
  if (count(cost)) usage.cost = count(cost)
  return usage
}

const addUsage = (a: TurnUsage, b: TurnUsage): TurnUsage => {
  const sum = (x = 0, y = 0) => x + y
  const usage: TurnUsage = {
    promptTokens: a.promptTokens + b.promptTokens,
    completionTokens: a.completionTokens + b.completionTokens
  }
  const cached = sum(a.cachedPromptTokens, b.cachedPromptTokens)
  const reasoning = sum(a.reasoningTokens, b.reasoningTokens)
  const cost = sum(a.cost, b.cost)
  if (cached) usage.cachedPromptTokens = cached
  if (reasoning) usage.reasoningTokens = reasoning
  if (cost) usage.cost = cost
  return usage
}

/**
 * The session's usage so far.
 *
 * Each `step-finish` part carries one model call's counts. A message with no
 * finished step yet falls back to its own `tokens`, which OpenCode fills as
 * the message settles; counting both would count that call twice.
 */
export const readOpencodeUsage = (entries: readonly unknown[]): TurnUsage => {
  let total: TurnUsage = { promptTokens: 0, completionTokens: 0 }
  for (const entry of entries) {
    if (!isAssistant(entry)) continue
    const steps = partsOf(entry).filter((part) => part.type === "step-finish")
    const counted =
      steps.length > 0
        ? steps.map((step) => readTokens(step.tokens, step.cost))
        : [
            readTokens(
              (entry as { info: Record<string, unknown> }).info.tokens,
              (entry as { info: Record<string, unknown> }).info.cost
            )
          ]
    for (const usage of counted) if (usage) total = addUsage(total, usage)
  }
  return total
}

const httpUrl = (value: string): string | null => {
  try {
    const url = new URL(value)
    return url.protocol === "http:" || url.protocol === "https:"
      ? url.href
      : null
  } catch {
    return null
  }
}

const URL_LINE = /^[ \t]*URL:[ \t]*(\S+)/gm
const TITLE_LINE = /^[ \t]*Title:[ \t]*(.+)$/gm

/** Exa's text results: a `Title:` line, then the result's `URL:` line. */
const readTextResults = (output: string): TurnSource[] => {
  const titles = [...output.matchAll(TITLE_LINE)].map((match) => ({
    at: match.index ?? 0,
    title: (match[1] ?? "").trim()
  }))
  const sources: TurnSource[] = []
  let previousUrlAt = -1
  for (const match of output.matchAll(URL_LINE)) {
    const at = match.index ?? 0
    const url = httpUrl(match[1] ?? "")
    if (!url) continue
    const title = titles.findLast((t) => t.at > previousUrlAt && t.at < at)
    previousUrlAt = at
    sources.push(title?.title ? { url, title: title.title } : { url })
  }
  return sources
}

/** Objects carrying a string `url` anywhere in a JSON result body. */
const readJsonResults = (output: string): TurnSource[] => {
  let parsed: unknown
  try {
    parsed = JSON.parse(output)
  } catch {
    return []
  }
  const sources: TurnSource[] = []
  const visit = (value: unknown, depth: number) => {
    if (depth > 6) return
    if (Array.isArray(value)) {
      for (const item of value) visit(item, depth + 1)
      return
    }
    if (!isRecord(value)) return
    const url = typeof value.url === "string" ? httpUrl(value.url) : null
    if (url) {
      const title = typeof value.title === "string" ? value.title.trim() : ""
      sources.push(title ? { url, title } : { url })
      return
    }
    for (const child of Object.values(value)) visit(child, depth + 1)
  }
  visit(parsed, 0)
  return sources
}

/**
 * Result pages from a `websearch` tool's text output.
 *
 * OpenCode passes the search provider's text through unparsed, and which
 * provider answered is chosen per session, so no one format can be assumed.
 * Only a result's own URL field is read — Exa's `URL:` line, or a JSON
 * result's `url` — never every link in the text: result bodies quote links of
 * their own, and listing those would cite pages nobody searched for. Output
 * in neither shape yields nothing rather than a guess.
 */
export const readSearchOutput = (output: string): TurnSource[] => {
  const text = readTextResults(output)
  return text.length > 0 ? text : readJsonResults(output)
}

/**
 * Pages the session's web tools read, in order: a page `webfetch` opened is
 * listed before a search hit, because it was read rather than only listed.
 * Only completed tool calls count — a failed fetch read nothing.
 */
/** The completed web tool calls among a session's assistant parts. */
const completedWebTools = (entries: readonly unknown[]) =>
  entries
    .filter(isAssistant)
    .flatMap(partsOf)
    .flatMap((part) =>
      part.type === "tool" &&
      (part.tool === "webfetch" || part.tool === "websearch") &&
      isRecord(part.state) &&
      part.state.status === "completed"
        ? [{ tool: part.tool, state: part.state }]
        : []
    )

export const collectOpencodeSources = (
  entries: readonly unknown[]
): TurnSource[] => {
  const fetched: TurnSource[] = []
  const searched: TurnSource[] = []
  for (const { tool, state } of completedWebTools(entries)) {
    if (tool === "webfetch") {
      const input = isRecord(state.input) ? state.input : {}
      const url = typeof input.url === "string" ? httpUrl(input.url) : null
      if (url) fetched.push({ url })
    } else if (typeof state.output === "string") {
      searched.push(...readSearchOutput(state.output))
    }
  }

  const byUrl = new Map<string, TurnSource>()
  for (const source of [...fetched, ...searched]) {
    const known = byUrl.get(source.url)
    if (!known) byUrl.set(source.url, source)
    else if (!known.title && source.title) known.title = source.title
  }
  return [...byUrl.values()].slice(0, MAX_OPENCODE_SOURCES)
}

/**
 * The HTTP status and retry delay an OpenCode `APIError` carries.
 *
 * OpenCode records the upstream provider's answer on the message error
 * (`data.statusCode`, `data.responseHeaders`); other error kinds carry neither
 * and stay unclassified.
 */
export const readOpencodeFailureStatus = (
  failure: unknown
): { status?: number; retryAfterSeconds?: number } => {
  if (!isRecord(failure) || !isRecord(failure.data)) return {}
  const data = failure.data
  const status =
    typeof data.statusCode === "number" &&
    Number.isInteger(data.statusCode) &&
    data.statusCode >= 400 &&
    data.statusCode <= 599
      ? data.statusCode
      : undefined
  const headers = isRecord(data.responseHeaders) ? data.responseHeaders : {}
  const header = Object.entries(headers).find(
    ([name]) => name.toLowerCase() === "retry-after"
  )?.[1]
  const seconds = typeof header === "string" ? Number(header.trim()) : NaN
  const retryAfterSeconds =
    Number.isFinite(seconds) && seconds > 0 ? Math.ceil(seconds) : undefined
  return {
    ...(status !== undefined ? { status } : {}),
    ...(retryAfterSeconds !== undefined ? { retryAfterSeconds } : {})
  }
}
