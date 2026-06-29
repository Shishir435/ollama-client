import DOMPurify from "dompurify"
import MarkdownIt from "markdown-it"
import container from "markdown-it-container"
import deflist from "markdown-it-deflist"
import { full as emoji } from "markdown-it-emoji"
import footnote from "markdown-it-footnote"
import markdownItMark from "markdown-it-mark"
import sub from "markdown-it-sub"
import sup from "markdown-it-sup"
import taskLists from "markdown-it-task-lists"
import { useEffect, useMemo, useState } from "react"

// highlight.js (core + ~20 languages) is heavy; keep it out of the eager
// side-panel bundle. Load it on demand the first time a code fence appears,
// then re-render to colorise. Until then code blocks render escaped + plain.
let hljsModule: typeof import("@/lib/hljs") | null = null
let hljsLoading: Promise<void> | null = null
const ensureHljs = (): Promise<void> => {
  if (hljsModule) return Promise.resolve()
  if (!hljsLoading) {
    hljsLoading = import("@/lib/hljs")
      .then((mod) => {
        hljsModule = mod
      })
      .catch((error) => {
        // Let a later code-fence render retry instead of caching the rejection.
        hljsLoading = null
        throw error
      })
  }
  return hljsLoading
}

const CODE_FENCE = /(^|\n)\s*(```|~~~)/

export const useMarkdownParser = (markdown: string) => {
  const md = useMemo(() => {
    const instance = new MarkdownIt({
      html: true,
      linkify: true,
      typographer: true,
      highlight(str, lang) {
        const safeLang = instance.utils.escapeHtml(lang || "")
        const langAttrs = safeLang ? ` data-code-language="${safeLang}"` : ""
        const hljs = hljsModule?.hljs
        if (hljs && lang && hljs.getLanguage(lang)) {
          try {
            return `<pre class="hljs"${langAttrs}><code class="language-${safeLang}">${
              hljs.highlight(str, {
                language: lang,
                ignoreIllegals: true
              }).value
            }</code></pre>`
          } catch {}
        }
        return `<pre class="hljs"${langAttrs}><code>${instance.utils.escapeHtml(str)}</code></pre>`
      }
    })

    instance
      .use(taskLists, { enabled: true })
      .use(footnote)
      .use(container, "info")
      .use(container, "warning")
      .use(emoji)
      .use(markdownItMark)
      .use(deflist)
      .use(sub)
      .use(sup)

    return instance
  }, [])

  const [hljsReady, setHljsReady] = useState(() => hljsModule !== null)
  const [html, setHtml] = useState(() => {
    const rawHtml = md.render(markdown)
    return DOMPurify.sanitize(rawHtml)
  })

  // Re-render on content change and once highlight.js has loaded.
  // biome-ignore lint/correctness/useExhaustiveDependencies: hljsReady is a deliberate re-render trigger (highlight after lazy load)
  useEffect(() => {
    const rafId = requestAnimationFrame(() => {
      const rawHtml = md.render(markdown)
      const safeHtml = DOMPurify.sanitize(rawHtml)
      setHtml(safeHtml)
    })

    return () => cancelAnimationFrame(rafId)
  }, [markdown, md, hljsReady])

  // Lazy-load highlight.js the first time the content has a code fence.
  useEffect(() => {
    if (hljsReady || !CODE_FENCE.test(markdown)) return
    let cancelled = false
    ensureHljs()
      .then(() => {
        if (!cancelled) setHljsReady(true)
      })
      .catch(() => {
        // Highlighting stays off; a later render can retry.
      })
    return () => {
      cancelled = true
    }
  }, [markdown, hljsReady])

  return html
}
