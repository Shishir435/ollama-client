import { useMarkdownParser } from "@/hooks/use-markdown-parser"

import TypingDots from "./ui/typing-dots"

export function MarkdownRenderer({ content }: { content: string }) {
  const html = useMarkdownParser(content)
  if (html.length === 0) return <TypingDots />
  return (
    <div
      className="prose prose-sm max-w-none break-words px-2 py-1 dark:prose-invert [&_code]:whitespace-pre-wrap [&_code]:text-black dark:[&_code]:text-white [&_p]:my-1 [&_pre]:overflow-x-auto [&_pre]:rounded [&_pre]:bg-gray-100 [&_pre]:p-2 [&_pre]:text-xs [&_pre]:text-black dark:[&_pre]:bg-gray-900 dark:[&_pre]:text-white [&_table]:block [&_table]:overflow-x-auto"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}
