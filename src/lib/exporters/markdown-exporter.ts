import type { TFunction } from "i18next"
import { STORAGE_KEYS } from "@/lib/constants"
import { getPlasmoStoredValue } from "@/lib/plasmo-global-storage"
import type { ChatMessage, ChatSession } from "@/types"
import {
  EXPORT_ALLOWED_ATTR,
  EXPORT_ALLOWED_TAGS,
  EXPORT_ALLOWED_URI_REGEXP
} from "./export-sanitizer"
import { createMarkdownParser } from "./markdown-utils"
import type { Exporter, ExportOptions } from "./types"
import { downloadFile } from "./utils"

/**
 * Markdown export of one chat.
 *
 * Message text is already Markdown, so it is kept as written — except for what
 * the PDF pipeline's sanitizer would strip: raw HTML outside the export
 * allow-list, attributes outside it, links and images with a scheme outside
 * it, and remote images unless the user opted in. A Markdown file is opened in
 * whatever viewer the user likes, so an exported `<script>` or a tracking
 * pixel must not ride along. Nothing the model never showed is exported either:
 * reasoning text, opaque replay blocks, tool results, system rows and
 * credentials are not part of a message's visible content and are not read.
 */

export interface MarkdownExportOptions {
  /** Keep remote http(s) images as images (user opt-in). Default: blocked. */
  allowRemoteImages?: boolean
}

const ALLOWED_TAGS = new Set(EXPORT_ALLOWED_TAGS)
const ALLOWED_ATTRS = new Set(EXPORT_ALLOWED_ATTR)

const isAllowedUri = (uri: string): boolean => {
  /** Viewers decode entities in a destination, so `javascript&#58;` is a scheme. */
  const trimmed = uri
    .trim()
    .replace(/&#(x?)([0-9a-f]+);?/gi, (_, hex: string, code: string) =>
      String.fromCodePoint(Number.parseInt(code, hex ? 16 : 10) || 0xfffd)
    )
    .replace(/&colon;/gi, ":")
  /** No scheme at all (an anchor or relative path) is inert in a text file. */
  if (!/^[a-z][a-z0-9+.-]*:/i.test(trimmed)) return true
  return EXPORT_ALLOWED_URI_REGEXP.test(trimmed)
}

const isRemote = (uri: string): boolean => /^https?:/i.test(uri.trim())

const hostOf = (uri: string): string => {
  try {
    return new URL(uri.trim()).host
  } catch {
    return ""
  }
}

/** One raw HTML tag, kept only when everything on it is on the allow-list. */
const sanitizeTag = (tag: string): string => {
  const match = /^<(\/?)([a-zA-Z][a-zA-Z0-9-]*)([\s\S]*?)(\/?)>$/.exec(tag)
  if (!match) return ""
  const [, closing, rawName, rest, selfClosing] = match
  const name = rawName.toLowerCase()
  if (!ALLOWED_TAGS.has(name)) return ""
  if (closing) return `</${name}>`
  const attrs: string[] = []
  const attrPattern =
    /([a-zA-Z_:][-a-zA-Z0-9_:.]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g
  for (const [, attrName, dq, sq, bare] of rest.matchAll(attrPattern)) {
    const key = attrName.toLowerCase()
    if (!ALLOWED_ATTRS.has(key) || key === "style" || key.startsWith("on")) {
      continue
    }
    const value = dq ?? sq ?? bare ?? ""
    if ((key === "href" || key === "src") && !isAllowedUri(value)) continue
    attrs.push(` ${key}="${value.replace(/"/g, "&quot;")}"`)
  }
  return `<${name}${attrs.join("")}${selfClosing ? " /" : ""}>`
}

const sanitizeHtml = (html: string): string =>
  html
    .replace(/<(script|style|iframe|object|embed)\b[\s\S]*?<\/\1\s*>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<\/?[a-zA-Z][^<>]*>/g, (tag) => {
      /** `<https://…>` and `<me@host>` are Markdown autolinks, not tags. */
      const autolink =
        /^<([a-zA-Z][a-zA-Z0-9+.-]*:[^\s<>]*|[^\s<>@]+@[^\s<>]+)>$/.exec(tag)
      if (autolink) {
        return autolink[1].includes(":") && !isAllowedUri(autolink[1])
          ? ""
          : tag
      }
      return sanitizeTag(tag)
    })

/** Markdown links and images outside code, judged by their destination. */
const sanitizeLinks = (
  text: string,
  options: MarkdownExportOptions,
  blockedLabel: string
): string =>
  text
    .replace(
      /!\[([^\]]*)\]\(\s*<?([^\s)>]*)>?(?:\s+(?:"[^"]*"|'[^']*'))?\s*\)/g,
      (whole, alt: string, uri: string) => {
        if (!isAllowedUri(uri)) return alt
        if (isRemote(uri) && !options.allowRemoteImages) {
          const host = hostOf(uri)
          const label = blockedLabel || alt
          return host ? `[${label}: ${host}]` : `[${label}]`
        }
        return whole
      }
    )
    .replace(
      /(?<!!)\[([^\]]*)\]\(\s*<?([^\s)>]*)>?(?:\s+(?:"[^"]*"|'[^']*'))?\s*\)/g,
      (whole, label: string, uri: string) => (isAllowedUri(uri) ? whole : label)
    )
    /** Reference definitions: a disallowed one is dropped. */
    .replace(
      /^ {0,3}\[[^\]]+\]:[ \t]*<?([^\s>]*)>?.*$/gm,
      (whole, uri: string) => (isAllowedUri(uri) ? whole : "")
    )
    /** A reference image would load on open; without the opt-in it is a link. */
    .replace(/!(\[[^\]]*\]\[[^\]]*\])/g, (whole, link: string) =>
      options.allowRemoteImages ? whole : link
    )

/** Inline code spans are copied untouched; prose between them is sanitized. */
const sanitizeProse = (
  text: string,
  options: MarkdownExportOptions,
  blockedLabel: string
): string =>
  text
    .split(/(`+[^`]*?`+)/)
    .map((part, index) =>
      index % 2 === 1
        ? part
        : sanitizeLinks(sanitizeHtml(part), options, blockedLabel)
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
    out.push(sanitizeProse(prose.join("\n"), options, blockedLabel))
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

const isoSeconds = (timestamp: number): string =>
  `${new Date(timestamp).toISOString().replace("T", " ").slice(0, 19)} UTC`

const oneLine = (value: string): string => value.replace(/\s+/g, " ").trim()

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
    const label = oneLine(title ?? "") || url || ""
    const key = url ?? label
    if (!label || seen.has(key)) return
    seen.add(key)
    lines.push(
      url && /^https?:/i.test(url)
        ? `- [${label.replace(/[[\]]/g, "")}](${url})`
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

export const renderSessionMarkdown = (
  session: ChatSession,
  t: TFunction,
  options: MarkdownExportOptions = {}
): string => {
  const blockedLabel = t("sessions.export.remote_image_blocked")
  const title = oneLine(session.title) || t("sessions.export.default_title")
  const header = [`# ${title}`, ""]
  if (session.modelId) {
    header.push(`- **${t("sessions.export.md_model")}:** ${session.modelId}`)
  }
  header.push(
    `- **${t("sessions.export.md_created")}:** ${isoSeconds(session.createdAt)}`,
    `- **${t("sessions.export.md_updated")}:** ${isoSeconds(session.updatedAt)}`
  )

  const blocks = activeBranch(session)
    .filter(isExportable)
    .map((message) => {
      const model =
        message.role === "assistant" && message.model
          ? ` (${oneLine(message.model)})`
          : ""
      const parts = [
        `## ${roleLabel(message, t)}${model}`,
        `*${isoSeconds(message.timestamp ?? session.updatedAt)}*`
      ]
      const body =
        message.agentRunId && !message.content.trim()
          ? t("sessions.export.agent_no_result")
          : sanitizeMarkdownForExport(message.content, options, blockedLabel)
      if (body.trim()) parts.push(body.trim())
      const names = [
        ...(message.attachments ?? []).map((file) => file.fileName),
        ...(message.images ?? []).map((image) => image.fileName)
      ]
        .map((name) => oneLine(name ?? ""))
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

  return `${[header.join("\n"), ...blocks].join("\n\n---\n\n")}\n`
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
