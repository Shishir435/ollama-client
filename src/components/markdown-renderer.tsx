import { useCopyCode as initializeCopyCode } from "markdown-it-copy-code"
import { useEffect, useRef } from "react"

import { useMarkdownParser } from "@/hooks/use-markdown-parser"

export const MarkdownRenderer = ({ content }: { content: string }) => {
  const html = useMarkdownParser(content)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (containerRef.current) {
      initializeCopyCode()
    }
  }, [])

  return (
    <div
      ref={containerRef}
      className="markdown-container prose prose-sm max-w-none wrap-break-word px-2 py-1 dark:prose-invert [&_code]:wrap-break-word [&_code]:whitespace-pre-wrap [&_pre]:max-w-full [&_pre]:overflow-x-auto [&_pre]:rounded [&_pre]:bg-muted [&_pre]:p-2 [&_pre]:text-xs [&_pre_code]:text-foreground [&_table]:block [&_table]:overflow-x-auto"
      // biome-ignore lint/security/noDangerouslySetInnerHtml: Content is sanitized by DOMPurify in useMarkdownParser
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}
