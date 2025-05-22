import MarkdownIt from "markdown-it"
import { useEffect, useState } from "react"

const md = new MarkdownIt({
  html: false,
  linkify: true,
  typographer: true
})

export function useMarkdownParser(markdown: string) {
  const [html, setHtml] = useState("")

  useEffect(() => {
    const rendered = md.render(markdown)
    setHtml(rendered)
  }, [markdown])

  return html
}
