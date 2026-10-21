import MarkdownIt from "markdown-it"
import { useEffect, useMemo, useRef, useState } from "react"
import { sanitizedHtmlToReactNodes } from "@/lib/sanitized-html-to-react"

const md = new MarkdownIt({ html: false, linkify: true, typographer: true })

export function PanelMarkdown({ content }: { content: string }) {
  const [html, setHtml] = useState(() => md.render(content))
  const markdownNodes = useMemo(() => sanitizedHtmlToReactNodes(html), [html])
  const rafRef = useRef<number | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    rafRef.current = requestAnimationFrame(() => {
      setHtml(md.render(content))
    })
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
    }
  }, [content])

  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const handleClick = (e: MouseEvent) => {
      const anchor = (e.target as HTMLElement)?.closest(
        "a[href]"
      ) as HTMLAnchorElement | null
      if (!anchor) return
      const href = anchor.getAttribute("href")?.trim()
      if (href && /^https?:/.test(href)) {
        e.preventDefault()
        window.open(href, "_blank", "noopener,noreferrer")
      }
    }
    container.addEventListener("click", handleClick)
    return () => container.removeEventListener("click", handleClick)
  }, [])

  return (
    <div ref={containerRef} className="sa-markdown">
      {markdownNodes}
    </div>
  )
}
