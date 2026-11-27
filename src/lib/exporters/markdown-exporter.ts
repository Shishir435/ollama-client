import type { TFunction } from "i18next"
import MarkdownIt from "markdown-it"
import { STORAGE_KEYS } from "@/lib/constants"
import { getPlasmoStoredValue } from "@/lib/plasmo-global-storage"
import type { ChatMessage, ChatSession } from "@/types"
import { createMarkdownParser } from "./markdown-utils"
import type { Exporter, ExportOptions } from "./types"
import { downloadFile } from "./utils"

/**
 * Markdown export of one chat.
 *
 * Message text is already Markdown, so it is kept as written, with three
 * exceptions. Raw HTML in prose is escaped to literal text, links with a
 * scheme outside the export allow-list lose their destination, and remote
 * images become plain text unless the user opted in. A Markdown file is opened
 * in whatever viewer the user likes, so an exported `<script>` or a tracking
 * pixel must not ride along. Nothing the model never showed is exported either:
 * reasoning text, opaque replay blocks, tool results, system rows and
 * credentials are not part of a message's visible content and are not read.
 */

export interface MarkdownExportOptions {
  /** Keep remote http(s) images as images (user opt-in). Default: blocked. */
  allowRemoteImages?: boolean
}

const NAMED_ENTITIES: Record<string, string> = {
  colon: ":",
  tab: "\t",
  newline: "\n"
}

/**
 * A destination as a viewer reads it: character references decoded, then the
 * tabs, newlines and control characters a URL parser drops removed.
 */
const normalizeUri = (uri: string): string =>
  Array.from(
    uri
      .replace(/&#(x?)([0-9a-f]+);?/gi, (_, hex: string, code: string) => {
        const point = Number.parseInt(code, hex ? 16 : 10)
        return String.fromCodePoint(
          point > 0 && point <= 0x10ffff ? point : 0xfffd
        )
      })
      .replace(
        /&([a-z]+);/gi,
        (whole, name: string) => NAMED_ENTITIES[name.toLowerCase()] ?? whole
      )
  )
    .filter((char) => char > " " && char !== "\u007f")
    .join("")

/**
 * No scheme at all (an anchor or relative path) is inert in a text file.
 * Links may go to the web or mail; an image may also be inline data.
 */
const isAllowedUri = (uri: string, image = false): boolean => {
  const normalized = normalizeUri(uri)
  return (
    !/^[^/?#]*:/.test(normalized) ||
    (image ? /^(?:https?:|data:image\/)/i : /^(?:https?|mailto):/i).test(
      normalized
    )
  )
}

/** Any http(s) or protocol-relative destination, however its slashes are spelled. */
const remoteHost = (uri: string): string | undefined => {
  const normalized = normalizeUri(uri).replace(/\\/g, "/")
  if (!/^(?:https?:|\/\/)/i.test(normalized)) return undefined
  try {
    return new URL(normalized.replace(/^\/\//, "https://")).host
  } catch {
    return ""
  }
}

/** CommonMark's URI and email autolinks. */
const AUTOLINK =
  /^<([a-z][a-z0-9+.-]{1,31}:[^\s<>]*|[\w.!#$%&'*+/=?^`{|}~-]+@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*)>/i
const INLINE_IMAGE =
  /^!\[([^\]]*)\]\(\s*<?([^\s)>]*)>?(?:\s+(?:"[^"]*"|'[^']*'))?\s*\)/
const INLINE_LINK =
  /^\[([^\]]*)\]\(\s*<?([^\s)>]*)>?(?:\s+(?:"[^"]*"|'[^']*'))?\s*\)/

/**
 * Prose outside code, scanned once left to right. Every `<` that could open a
 * tag is escaped unless it starts an allowed autolink, so no HTML survives
 * however its attributes are quoted. Every image opener that is not a kept
 * inline image is escaped when remote images are blocked, which covers full,
 * collapsed and shortcut reference images without resolving them.
 */
const sanitizeProse = (
  text: string,
  options: MarkdownExportOptions,
  blockedLabel: string
): string => {
  let out = ""
  let index = 0
  while (index < text.length) {
    const rest = text.slice(index)
    const char = text[index]
    if (char === "\\") {
      out += text.slice(index, index + 2)
      index += 2
      continue
    }
    if (char === "<") {
      const autolink = AUTOLINK.exec(rest)
      if (
        autolink &&
        (!autolink[1].includes(":") || isAllowedUri(autolink[1]))
      ) {
        out += autolink[0]
        index += autolink[0].length
        continue
      }
      out += /^<[a-z/!?]/i.test(rest) ? "\\<" : "<"
      index += 1
      continue
    }
    const image = char === "!" ? INLINE_IMAGE.exec(rest) : null
    if (image) {
      const [whole, rawAlt, uri] = image
      const alt = sanitizeProse(rawAlt, options, blockedLabel)
      const host = remoteHost(uri)
      if (!isAllowedUri(uri, true)) out += alt
      else if (host !== undefined && !options.allowRemoteImages) {
        const label = blockedLabel || alt
        out += host ? `[${label}: ${host}]` : `[${label}]`
      } else out += `![${alt}${whole.slice(2 + rawAlt.length)}`
      index += whole.length
      continue
    }
    if (char === "!" && text[index + 1] === "[" && !options.allowRemoteImages) {
      out += "\\!"
      index += 1
      continue
    }
    const link = char === "[" ? INLINE_LINK.exec(rest) : null
    if (link) {
      const [whole, rawLabel, uri] = link
      const label = sanitizeProse(rawLabel, options, blockedLabel)
      out += isAllowedUri(uri)
        ? `[${label}${whole.slice(1 + rawLabel.length)}`
        : label
      index += whole.length
      continue
    }
    out += char
    index += 1
  }
  /** Reference definitions: a disallowed one is dropped. */
  return out.replace(
    /^ {0,3}\[[^\]]+\]:[ \t]*<?([^\s>]*)>?.*$/gm,
    (whole, uri) => (isAllowedUri(uri) ? whole : "")
  )
}

/**
 * Inline code spans are copied untouched; prose between them is sanitized. A
 * span opens and closes on backtick runs of the same length, as CommonMark
 * requires, so an unmatched or escaped run leaves what follows it as prose.
 */
const sanitizeLine = (
  text: string,
  options: MarkdownExportOptions,
  blockedLabel: string
): string =>
  text
    .split(/((?<![`\\])(`+)(?!`)[\s\S]*?(?<!`)\2(?!`))/)
    .filter((_, index) => index % 3 !== 2)
    .map((part, index) =>
      index % 2 === 1 ? part : sanitizeProse(part, options, blockedLabel)
    )
    .join("")

/**
 * The Markdown of one message body with the sanitizer's removals applied.
 * Fenced and indented code is left exactly as written: it is text, not markup,
 * and rewriting an example would change what the answer said.
 */
export const sanitizeMarkdownForExport = (
  content: string,
  options: MarkdownExportOptions = {},
  blockedLabel = ""
): string => {
  const lines = content.split("\n")
  const keep = Array.from({ length: lines.length }, () => false)
  for (const token of createMarkdownParser().parse(content, {})) {
    if (!token.map) continue
    if (token.type === "fence" || token.type === "code_block") {
      for (let line = token.map[0]; line < token.map[1]; line += 1) {
        keep[line] = true
      }
    }
  }
  const out: string[] = []
  let prose: string[] = []
  const flush = () => {
    if (prose.length === 0) return
    out.push(sanitizeLine(prose.join("\n"), options, blockedLabel))
    prose = []
  }
  lines.forEach((line, index) => {
    if (keep[index]) {
      flush()
      out.push(line)
    } else {
      prose.push(line)
    }
  })
  flush()
  return out.join("\n")
}

/**
 * A second reading by a CommonMark parser that accepts every destination as
 * written. Whatever it finds as HTML, a disallowed link or a blocked image is
 * something the scanner above missed.
 */
const reader = new MarkdownIt({ html: true })
reader.validateLink = () => true
reader.normalizeLink = (url) => url

type References = Record<string, { href: string }>

interface Reading {
  /** Every link and image destination, in order. */
  uris: string[]
  /** The definitions in force: the text's own, after any it was given. */
  references: References
}

/**
 * `null` when the reader finds HTML or a destination it must not follow.
 * Given the file's definitions, a message reads as it does inside the file.
 */
const read = (
  markdown: string,
  options: MarkdownExportOptions,
  given: References = {}
): Reading | null => {
  const env = { references: { ...given } }
  const tokens = reader
    .parse(markdown, env)
    .flatMap((token) => [token, ...(token.children ?? [])])
  const references = env.references
  if (!Object.values(references).every((ref) => isAllowedUri(ref.href))) {
    return null
  }
  const uris: string[] = []
  for (const token of tokens) {
    if (token.type === "html_block" || token.type === "html_inline") {
      return null
    }
    const image = token.type === "image"
    const uri = token.attrGet(image ? "src" : "href")
    if (uri === null) continue
    if (
      !isAllowedUri(uri, image) ||
      (image && !options.allowRemoteImages && remoteHost(uri) !== undefined)
    ) {
      return null
    }
    uris.push(uri)
  }
  return { uris, references }
}

/** Safe, and closed: a fence left open would swallow the next message. */
const isSettled = (markdown: string, options: MarkdownExportOptions) =>
  read(markdown, options) !== null &&
  reader.parse(`${markdown}\n\n---\n`, {}).at(-1)?.type === "hr"

/** Text no reader renders: a fence longer than any backtick run inside it. */
const asCode = (text: string): string => {
  const runs = (text.match(/`+/g) ?? []).map((run) => run.length + 1)
  const fence = "`".repeat(Math.max(3, ...runs))
  return `${fence}text\n${text}\n${fence}`
}

const isoSeconds = (timestamp: number): string =>
  `${new Date(timestamp).toISOString().replace("T", " ").slice(0, 19)} UTC`

const oneLine = (value: string): string => value.replace(/\s+/g, " ").trim()

/** Metadata (titles, names) as literal text: every markup character escaped. */
const literal = (value: string): string =>
  oneLine(value).replace(/[\\`*_{}[\]()<>#+!|~&]/g, "\\$&")

/** A generated link destination that cannot end early or open a tag. */
const destination = (url: string): string =>
  url.replace(
    /[\s()<>\\]/g,
    (char) =>
      `%${char.charCodeAt(0).toString(16).toUpperCase().padStart(2, "0")}`
  )

const roleLabel = (message: ChatMessage, t: TFunction): string => {
  if (message.role === "user") return t("sessions.export.role_user")
  return message.agentRunId
    ? t("sessions.export.role_agent")
    : t("sessions.export.role_assistant")
}

/** Sources the answer actually consulted: titles, with a link where one exists. */
const messageSources = (message: ChatMessage): string[] => {
  const seen = new Set<string>()
  const lines: string[] = []
  const add = (title: string | undefined, url?: string) => {
    const label = literal(title ?? "") || literal(url ?? "")
    const key = url ?? label
    if (!label || seen.has(key)) return
    seen.add(key)
    lines.push(
      url && /^https?:/i.test(normalizeUri(url))
        ? `- [${label}](${destination(url)})`
        : `- ${label}`
    )
  }
  for (const run of message.metrics?.toolRuns ?? []) {
    for (const source of run.sources ?? []) {
      if (source.used === false) continue
      add(source.title, source.url)
    }
  }
  for (const citation of message.metrics?.webCitations ?? []) {
    add(citation.title, citation.url)
  }
  for (const source of message.metrics?.ragSources ?? []) {
    add(source.title || source.source)
  }
  for (const chunk of message.metrics?.usedContextChunks ?? []) {
    add(chunk.title || chunk.source)
  }
  return lines
}

/** Only what the user saw: finished chat turns, never tool or system rows. */
const isExportable = (message: ChatMessage): boolean =>
  (message.role === "user" || message.role === "assistant") &&
  !message.metrics?.permissionNotice

/** The conversation the user is reading: the active branch, root to leaf. */
const activeBranch = (session: ChatSession): ChatMessage[] => {
  const messages = session.messages ?? []
  const byId = new Map(
    messages
      .filter((message) => message.id !== undefined)
      .map((message) => [String(message.id), message])
  )
  const leaf =
    session.currentLeafId !== undefined
      ? byId.get(String(session.currentLeafId))
      : undefined
  if (!leaf) return messages
  const path: ChatMessage[] = []
  const visited = new Set<string>()
  let cursor: ChatMessage | undefined = leaf
  while (cursor && !visited.has(String(cursor.id))) {
    visited.add(String(cursor.id))
    path.unshift(cursor)
    cursor =
      cursor.parentId !== undefined
        ? byId.get(String(cursor.parentId))
        : undefined
  }
  return path
}

/**
 * The export, with any message the second reading rejects kept as literal
 * text. Reference definitions are shared by the whole file, so a message whose
 * links resolve differently inside it than alone, because another message
 * defined one of its labels, is kept literal too. Failing that, every
 * message is.
 */
export const renderSessionMarkdown = (
  session: ChatSession,
  t: TFunction,
  options: MarkdownExportOptions = {}
): string => {
  const literalBodies = new Set<number>()
  for (let pass = 0; pass < 2; pass += 1) {
    const { markdown, blocks } = composeMarkdown(
      session,
      t,
      options,
      literalBodies
    )
    const whole = read(markdown, options)
    if (!whole) break
    const changed = blocks.flatMap((block, index) => {
      const alone = read(block, options)?.uris.join("\n")
      const inFile = read(block, options, whole.references)?.uris.join("\n")
      return alone !== undefined && alone === inFile ? [] : [index]
    })
    if (changed.length === 0) return markdown
    for (const index of changed) literalBodies.add(index)
  }
  return composeMarkdown(session, t, options, "all").markdown
}

const composeMarkdown = (
  session: ChatSession,
  t: TFunction,
  options: MarkdownExportOptions,
  literalBodies: ReadonlySet<number> | "all"
): { markdown: string; blocks: string[] } => {
  const blockedLabel = t("sessions.export.remote_image_blocked")
  const title = literal(session.title) || t("sessions.export.default_title")
  const header = [`# ${title}`, ""]
  if (session.modelId) {
    header.push(
      `- **${t("sessions.export.md_model")}:** ${literal(session.modelId)}`
    )
  }
  header.push(
    `- **${t("sessions.export.md_created")}:** ${isoSeconds(session.createdAt)}`,
    `- **${t("sessions.export.md_updated")}:** ${isoSeconds(session.updatedAt)}`
  )

  const blocks = activeBranch(session)
    .filter(isExportable)
    .map((message, index) => {
      const model =
        message.role === "assistant" && message.model
          ? ` (${literal(message.model)})`
          : ""
      const parts = [
        `## ${roleLabel(message, t)}${model}`,
        `*${isoSeconds(message.timestamp ?? session.updatedAt)}*`
      ]
      /** Leading spaces stay: four of them are what makes indented code. */
      const tidy = (text: string) =>
        text.replace(/^(?:[ \t]*\n)+/, "").trimEnd()
      const content = tidy(message.content)
      const sanitized = tidy(
        sanitizeMarkdownForExport(message.content, options, blockedLabel)
      )
      const keep =
        literalBodies !== "all" &&
        !literalBodies.has(index) &&
        isSettled(sanitized, options)
      const body =
        message.agentRunId && !content.trim()
          ? t("sessions.export.agent_no_result")
          : keep
            ? sanitized
            : asCode(content)
      if (body.trim()) parts.push(body)
      const names = [
        ...(message.attachments ?? []).map((file) => file.fileName),
        ...(message.images ?? []).map((image) => image.fileName)
      ]
        .map((name) => literal(name ?? ""))
        .filter(Boolean)
      if (names.length > 0) {
        parts.push(
          `**${t("sessions.export.md_attachments")}:** ${names.join(", ")}`
        )
      }
      const sources = messageSources(message)
      if (sources.length > 0) {
        parts.push(
          `**${t("sessions.export.md_sources")}:**`,
          sources.join("\n")
        )
      }
      return parts.join("\n\n")
    })

  return {
    markdown: `${[header.join("\n"), ...blocks].join("\n\n---\n\n")}\n`,
    blocks
  }
}

const safeFileName = (title: string, fallback: string): string =>
  `${
    oneLine(title)
      .replace(/[\\/:*?"<>|]+/g, "-")
      .slice(0, 100) || fallback
  }.md`

const allowRemoteExportImages = async (): Promise<boolean> =>
  (await getPlasmoStoredValue<boolean>(
    STORAGE_KEYS.EXPORT.ALLOW_REMOTE_IMAGES
  )) === true

export const markdownExporter: Pick<Exporter, "exportSession"> = {
  exportSession: async (
    session: ChatSession,
    t: TFunction,
    options?: ExportOptions
  ) => {
    const markdown = renderSessionMarkdown(session, t, {
      allowRemoteImages: await allowRemoteExportImages()
    })
    downloadFile(
      new Blob([markdown], { type: "text/markdown;charset=utf-8" }),
      options?.fileName ||
        safeFileName(session.title, t("sessions.export.default_title"))
    )
  }
}
