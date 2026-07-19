import DOMPurify from "dompurify"
import MarkdownIt, { type PluginWithParams } from "markdown-it"
import container from "markdown-it-container"
import MarkdownItCopyCode from "markdown-it-copy-code"
import deflist from "markdown-it-deflist"
import { full as emoji } from "markdown-it-emoji"
import footnote from "markdown-it-footnote"
import markdownItMark from "markdown-it-mark"
import sub from "markdown-it-sub"
import sup from "markdown-it-sup"
import taskLists from "markdown-it-task-lists"

import { hljs } from "@/lib/hljs"
import { logger } from "@/lib/logger"
import {
  EXPORT_ALLOWED_ATTR,
  EXPORT_ALLOWED_TAGS,
  EXPORT_ALLOWED_URI_REGEXP
} from "./export-sanitizer"

/**
 * Creates and configures the MarkdownIt parser instance
 * Reused for consistency across exports
 */
export const createMarkdownParser = () => {
  const md: MarkdownIt = new MarkdownIt({
    html: true,
    linkify: true,
    typographer: true,
    highlight: (str: string, lang: string): string => {
      if (lang && hljs.getLanguage(lang)) {
        try {
          return `<pre class="hljs"><code>${hljs.highlight(str, { language: lang, ignoreIllegals: true }).value}</code></pre>`
        } catch (e) {
          logger.warn(
            `Highlight failed for language: ${lang}`,
            "markdownUtils",
            { error: e }
          )
        }
      }
      return `<pre class="hljs"><code>${md.utils.escapeHtml(str)}</code></pre>`
    }
  })

  md.use(taskLists, { enabled: true })
    .use(footnote)
    // markdown-it-container ships @types/markdown-it v13, incompatible with our
    // v14 MarkdownIt type; the plugin is valid at runtime, so cast to v14 shape.
    .use(container as unknown as PluginWithParams, "info")
    .use(container as unknown as PluginWithParams, "warning")
    .use(emoji)
    .use(MarkdownItCopyCode)
    .use(markdownItMark)
    .use(deflist)
    .use(sub)
    .use(sup)

  return md
}

/**
 * Parses markdown content into sanitized HTML
 * Used for PDF export and potentially other HTML-based exports
 */
export const parseMessageContent = (
  content: string,
  md: MarkdownIt
): string => {
  try {
    const rawHtml = md.render(content)
    const safeHtml = DOMPurify.sanitize(rawHtml, {
      ALLOWED_TAGS: EXPORT_ALLOWED_TAGS,
      ALLOWED_ATTR: EXPORT_ALLOWED_ATTR,
      ALLOWED_URI_REGEXP: EXPORT_ALLOWED_URI_REGEXP
    })
    return safeHtml
  } catch (error) {
    logger.error("Error parsing markdown", "markdown-utils", { error })
    return md.utils.escapeHtml(content)
  }
}
