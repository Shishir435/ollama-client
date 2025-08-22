import { useEffect } from "react"

import { useCopyCode } from "markdown-it-copy-code"

import { useMarkdownParser } from "@/hooks/use-markdown-parser"

export const MarkdownRenderer = ({ content }: { content: string }) => {
  const html = useMarkdownParser(content)
  useEffect(() => {
    useCopyCode()
  }, [])
  return (
    <div
      className="markdown-container prose prose-sm max-w-none break-words px-2 py-1 dark:prose-invert [&_code]:whitespace-pre-wrap [&_code]:break-words [&_pre]:max-w-full [&_pre]:overflow-x-auto [&_pre]:rounded [&_pre]:bg-gray-200 [&_pre]:p-2 [&_pre]:text-xs dark:[&_pre]:bg-gray-900 [&_pre_code]:text-black dark:[&_pre_code]:text-white [&_table]:block [&_table]:overflow-x-auto"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}
