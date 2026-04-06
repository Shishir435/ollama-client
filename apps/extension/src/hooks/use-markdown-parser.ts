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
import { useEffect, useMemo, useState } from "react"

import { hljs } from "@/lib/hljs"

import "markdown-it-copy-code/styles/base.css"
import "markdown-it-copy-code/styles/small.css"

export const useMarkdownParser = (markdown: string) => {
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

  const [html, setHtml] = useState(() => {
    const rawHtml = md.render(markdown)
    return DOMPurify.sanitize(rawHtml)
  })

  useEffect(() => {
    const rafId = requestAnimationFrame(() => {
      const rawHtml = md.render(markdown)
      const safeHtml = DOMPurify.sanitize(rawHtml)
      setHtml(safeHtml)
    })

    return () => cancelAnimationFrame(rafId)
  }, [markdown, md])

  return html
}
