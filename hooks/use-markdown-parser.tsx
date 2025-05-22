import DOMPurify from "dompurify"
import hljs from "highlight.js"
import MarkdownIt from "markdown-it"
import container from "markdown-it-container"
import { full as emoji } from "markdown-it-emoji"
import footnote from "markdown-it-footnote"
import highlightjs from "markdown-it-highlightjs"
import taskLists from "markdown-it-task-lists"
import { useEffect, useState } from "react"

import "highlight.js/styles/github.css"

const md = new MarkdownIt({
  html: true,
  linkify: true,
  typographer: true,
  highlight: function (str, lang) {
    if (lang && hljs.getLanguage(lang)) {
      try {
        return `<pre class="hljs"><code>${hljs.highlight(str, { language: lang, ignoreIllegals: true }).value}</code></pre>`
      } catch (__) {}
    }
    return `<pre class="hljs"><code>${md.utils.escapeHtml(str)}</code></pre>`
  }
})

md.use(highlightjs, { hljs })
  .use(taskLists, { enabled: true })
  .use(footnote)
  .use(container, "info")
  .use(container, "warning")
  .use(emoji)

export function useMarkdownParser(markdown: string) {
  const [html, setHtml] = useState("")

  useEffect(() => {
    const rawHtml = md.render(markdown)
    const safeHtml = DOMPurify.sanitize(rawHtml)
    setHtml(safeHtml)
  }, [markdown])

  return html
}
