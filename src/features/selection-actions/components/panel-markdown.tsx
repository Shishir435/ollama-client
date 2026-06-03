import DOMPurify from "dompurify"
import MarkdownIt from "markdown-it"
import { useEffect, useRef, useState } from "react"

const md = new MarkdownIt({ html: false, linkify: true, typographer: true })

export function PanelMarkdown({ content }: { content: string }) {
  const [html, setHtml] = useState(() => DOMPurify.sanitize(md.render(content)))
  const rafRef = useRef<number | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    rafRef.current = requestAnimationFrame(() => {
      setHtml(DOMPurify.sanitize(md.render(content)))
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
    <div
      ref={containerRef}
      className="sa-markdown"
      // biome-ignore lint/security/noDangerouslySetInnerHtml: Sanitized by DOMPurify
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}
