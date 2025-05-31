import DOMPurify from "dompurify"
import hljs from "highlight.js"
import MarkdownIt from "markdown-it"
import container from "markdown-it-container"
import MarkdownItCopyCode from "markdown-it-copy-code"
import deflist from "markdown-it-deflist"
import { full as emoji } from "markdown-it-emoji"
import footnote from "markdown-it-footnote"
import highlightjs from "markdown-it-highlightjs"
import markdownItMark from "markdown-it-mark"
import sub from "markdown-it-sub"
import sup from "markdown-it-sup"
import taskLists from "markdown-it-task-lists"
import { useEffect, useMemo, useState } from "react"

import "markdown-it-copy-code/styles/base.css"
import "markdown-it-copy-code/styles/small.css"

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
  .use(MarkdownItCopyCode)
  .use(markdownItMark)
  .use(deflist)
  .use(sub)
  .use(sup)

export function useMarkdownParser(markdown: string) {
  const [html, setHtml] = useState("")
  const md = useMemo(() => {
    const instance = new MarkdownIt({
      html: true,
      linkify: true,
      typographer: true,
      highlight(str, lang) {
        if (lang && hljs.getLanguage(lang)) {
          try {
            return `<pre class="hljs"><code>${
              hljs.highlight(str, {
                language: lang,
                ignoreIllegals: true
              }).value
            }</code></pre>`
          } catch {}
        }
        return `<pre class="hljs"><code>${instance.utils.escapeHtml(str)}</code></pre>`
      }
    })

    instance
      .use(highlightjs, { hljs })
      .use(taskLists, { enabled: true })
      .use(footnote)
      .use(container, "info")
      .use(container, "warning")
      .use(emoji)
      .use(MarkdownItCopyCode)
      .use(markdownItMark)
      .use(deflist)
      .use(sub)
      .use(sup)

    return instance
  }, [])
  useEffect(() => {
    const rawHtml = md.render(markdown)
    const safeHtml = DOMPurify.sanitize(rawHtml)
    setHtml(safeHtml)
  }, [markdown, md])

  return html
}
