import { useEffect, useRef } from "react"
import { useMarkdownParser } from "@/hooks/use-markdown-parser"
import { openExternalUrl, openOptionsInTab, runtime } from "@/lib/browser-api"
import { MarkdownCodeBlockActions } from "./markdown-code-block-actions"

export const MarkdownRenderer = ({ content }: { content: string }) => {
  const html = useMarkdownParser(content)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const handleLinkClick = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null
      const anchor = target?.closest("a[href]") as HTMLAnchorElement | null
      if (!anchor) return

      const href = anchor.getAttribute("href")?.trim()
      if (!href) return

      const resolvedUrl = new URL(href, globalThis.location.href).toString()
      const optionsUrl = runtime.getURL("options.html")

      if (resolvedUrl.startsWith(optionsUrl)) {
        event.preventDefault()
        void openOptionsInTab(resolvedUrl)
        return
      }

      if (/^(https?:|chrome-extension:|moz-extension:)/i.test(resolvedUrl)) {
        event.preventDefault()
        openExternalUrl(resolvedUrl)
      }
    }

    container.addEventListener("click", handleLinkClick)
    return () => container.removeEventListener("click", handleLinkClick)
  }, [])

  return (
    <>
      <div
        ref={containerRef}
        className="markdown-container typeset typeset-chat max-w-none px-2 py-1"
        // biome-ignore lint/security/noDangerouslySetInnerHtml: Content is sanitized by DOMPurify in useMarkdownParser
        dangerouslySetInnerHTML={{ __html: html }}
      />
      <MarkdownCodeBlockActions containerRef={containerRef} html={html} />
    </>
  )
}
