import { useMarkdownParser } from "@/hooks/useMarkdownParser"

export function MarkdownRenderer({ content }: { content: string }) {
  const html = useMarkdownParser(content)

  return (
    <div
      className="prose prose-sm max-w-sm break-words px-2 py-1 [&_code]:whitespace-pre-wrap [&_code]:text-black [&_p]:my-1 [&_pre]:overflow-x-auto [&_pre]:rounded [&_pre]:bg-gray-100 [&_pre]:p-2 [&_pre]:text-xs [&_pre]:text-black [&_table]:block [&_table]:overflow-x-auto"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}
