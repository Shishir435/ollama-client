import DOMPurify from "dompurify"
import MarkdownIt, { type PluginWithParams } from "markdown-it"
import container from "markdown-it-container"
import deflist from "markdown-it-deflist"
import { full as emoji } from "markdown-it-emoji"
import footnote from "markdown-it-footnote"
import markdownItMark from "markdown-it-mark"
import sub from "markdown-it-sub"
import sup from "markdown-it-sup"
import taskLists from "markdown-it-task-lists"
import { useEffect, useRef, useState } from "react"

/**
 * highlight.js (core + ~20 languages) is heavy; keep it out of the eager
 * side-panel bundle. Load it on demand the first time a code fence appears,
 * then re-render to colorise. Until then code blocks render escaped + plain.
 */
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

/**
 * Shortest gap between two parses of the same message while its content is
 * still growing. A parse plus sanitize is O(message length) and replaces the
 * whole subtree, so one per token makes the last tokens the most expensive to
 * show; batching to this interval keeps the text reading as continuous.
 */
const STREAM_RENDER_INTERVAL_MS = 120

const createMarkdownParser = (): MarkdownIt => {
  const instance: MarkdownIt = new MarkdownIt({
    html: true,
    linkify: true,
    typographer: true,
    highlight(str: string, lang: string): string {
      const safeLang: string = instance.utils.escapeHtml(lang || "")
      const langAttrs: string = safeLang
        ? ` data-code-language="${safeLang}"`
        : ""
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
    // markdown-it-container ships @types/markdown-it v13, whose MarkdownIt type
    // is structurally incompatible with our v14; the plugin is valid at runtime,
    // so cast to the v14 params-plugin shape.
    .use(container as unknown as PluginWithParams, "info")
    .use(container as unknown as PluginWithParams, "warning")
    .use(emoji)
    .use(markdownItMark)
    .use(deflist)
    .use(sub)
    .use(sup)

  return instance
}

/**
 * One configured parser for the whole page.
 *
 * `MarkdownIt#render` carries nothing between calls — every rule works off the
 * per-call token stream and a fresh `env`, so footnote numbering still restarts
 * per message — while the nine plugin registrations and the rule-chain rebuild
 * were being paid once per mounted message bubble.
 *
 * The `highlight` callback reads `hljsModule`, which is module state already,
 * so sharing the instance does not change when highlighting turns on.
 */
const markdownParser = createMarkdownParser()

const renderMarkdown = (markdown: string): string =>
  DOMPurify.sanitize(markdownParser.render(markdown))

export const useMarkdownParser = (markdown: string) => {
  const [hljsReady, setHljsReady] = useState(() => hljsModule !== null)
  const [html, setHtml] = useState(() => renderMarkdown(markdown))

  /** The inputs the current `html` was produced from. */
  const renderedRef = useRef({ markdown, hljsReady })
  const lastRenderAtRef = useRef(Date.now())

  /**
   * Throttle rather than debounce: the first change after an idle gap renders
   * immediately, and anything arriving inside the window is coalesced into one
   * trailing render at the window's end. Because the trailing timer is
   * re-anchored on the last render — never on the last change — a stream that
   * stops mid-window still gets its final content rendered, exactly once.
   */
  useEffect(() => {
    const rendered = renderedRef.current
    if (rendered.markdown === markdown && rendered.hljsReady === hljsReady) {
      return
    }

    const render = () => {
      renderedRef.current = { markdown, hljsReady }
      lastRenderAtRef.current = Date.now()
      setHtml(renderMarkdown(markdown))
    }

    const elapsed = Date.now() - lastRenderAtRef.current
    if (elapsed >= STREAM_RENDER_INTERVAL_MS) {
      render()
      return
    }

    const timer = setTimeout(render, STREAM_RENDER_INTERVAL_MS - elapsed)
    return () => clearTimeout(timer)
  }, [markdown, hljsReady])

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
