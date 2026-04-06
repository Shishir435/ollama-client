import DOMPurify from "dompurify"
import MarkdownIt from "markdown-it"
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

/**
 * Creates and configures the MarkdownIt parser instance
 * Reused for consistency across exports
 */
export const createMarkdownParser = () => {
  const md = new MarkdownIt({
    html: true,
    linkify: true,
    typographer: true,
    highlight: (str, lang) => {
      if (lang && hljs.getLanguage(lang)) {
        try {
          return `<pre class="hljs"><code>${hljs.highlight(str, { language: lang, ignoreIllegals: true }).value}</code></pre>`
        } catch (__) {}
      }
      return `<pre class="hljs"><code>${md.utils.escapeHtml(str)}</code></pre>`
    }
  })

  md.use(taskLists, { enabled: true })
    .use(footnote)
    .use(container, "info")
    .use(container, "warning")
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
      ALLOWED_TAGS: [
        "p",
        "br",
        "strong",
        "em",
        "u",
        "strike",
        "code",
        "pre",
        "h1",
        "h2",
        "h3",
        "h4",
        "h5",
        "h6",
        "ul",
        "ol",
        "li",
        "blockquote",
        "a",
        "img",
        "table",
        "thead",
        "tbody",
        "tr",
        "th",
        "td",
        "div",
        "span",
        "mark",
        "sub",
        "sup",
        "del",
        "ins"
      ],
      ALLOWED_ATTR: [
        "href",
        "src",
        "alt",
        "title",
        "class",
        "id",
        "checked",
        "type"
      ]
    })
    return safeHtml
  } catch (error) {
    logger.error("Error parsing markdown", "markdown-utils", { error })
    return md.utils.escapeHtml(content)
  }
}
