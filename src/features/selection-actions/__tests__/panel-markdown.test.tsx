import { cleanup, render } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { PanelMarkdown } from "../components/panel-markdown"

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

function getMd(container: HTMLElement) {
  return container.querySelector(".sa-markdown") as HTMLDivElement
}

describe("PanelMarkdown", () => {
  it("renders plain text", () => {
    const { container } = render(<PanelMarkdown content="Hello world" />)
    expect(getMd(container)).toHaveTextContent("Hello world")
  })

  it("renders bold text", () => {
    const { container } = render(<PanelMarkdown content="Hello **world**" />)
    expect(getMd(container).innerHTML).toContain("<strong>world</strong>")
  })

  it("renders italic text", () => {
    const { container } = render(<PanelMarkdown content="Hello *world*" />)
    expect(getMd(container).innerHTML).toContain("<em>world</em>")
  })

  it("renders headings", () => {
    const { container } = render(
      <PanelMarkdown
        content={`# Heading 1

## Heading 2`}
      />
    )
    const md = getMd(container)
    expect(md.querySelector("h1")).toHaveTextContent("Heading 1")
    expect(md.querySelector("h2")).toHaveTextContent("Heading 2")
  })

  it("renders inline code", () => {
    const { container } = render(<PanelMarkdown content="Use `code` here" />)
    const md = getMd(container)
    expect(md.querySelector("code")).toHaveTextContent("code")
  })

  it("renders code blocks", () => {
    const { container } = render(
      <PanelMarkdown
        content={`\`\`\`js
const x = 1
\`\`\``}
      />
    )
    const md = getMd(container)
    expect(md.querySelector("pre")).toBeInTheDocument()
    expect(md.querySelector("code")).toHaveTextContent("const x = 1")
  })

  it("renders unordered lists", () => {
    const { container } = render(
      <PanelMarkdown
        content={`- item 1
- item 2`}
      />
    )
    const md = getMd(container)
    const items = md.querySelectorAll("li")
    expect(items).toHaveLength(2)
    expect(items[0]).toHaveTextContent("item 1")
    expect(items[1]).toHaveTextContent("item 2")
  })

  it("renders ordered lists", () => {
    const { container } = render(
      <PanelMarkdown
        content={`1. first
2. second`}
      />
    )
    const md = getMd(container)
    expect(md.querySelector("ol")).toBeInTheDocument()
  })

  it("renders blockquotes", () => {
    const { container } = render(<PanelMarkdown content="> quote text" />)
    const md = getMd(container)
    expect(md.querySelector("blockquote")).toHaveTextContent("quote")
  })

  it("renders links", () => {
    const { container } = render(
      <PanelMarkdown content="[click](https://example.com)" />
    )
    const md = getMd(container)
    const link = md.querySelector("a")
    expect(link).toHaveAttribute("href", "https://example.com")
    expect(link).toHaveTextContent("click")
  })

  it("sanitizes raw HTML", () => {
    const { container } = render(
      <PanelMarkdown content='<script>alert("xss")</script>' />
    )
    const md = getMd(container)
    expect(md.querySelector("script")).not.toBeInTheDocument()
  })

  it("opens links in new tab on click", () => {
    const open = vi.spyOn(window, "open").mockImplementation(() => null)

    const { container } = render(
      <PanelMarkdown content="[link](https://example.com)" />
    )
    const link = getMd(container).querySelector("a") as HTMLAnchorElement
    link.click()

    expect(open).toHaveBeenCalledWith(
      "https://example.com",
      "_blank",
      "noopener,noreferrer"
    )
  })

  it("does not open non-http links in new tab", () => {
    const open = vi.spyOn(window, "open").mockImplementation(() => null)

    const { container } = render(<PanelMarkdown content="[link](#anchor)" />)
    const link = getMd(container).querySelector("a") as HTMLAnchorElement
    link.click()

    expect(open).not.toHaveBeenCalled()
  })

  it("renders tables", () => {
    const { container } = render(
      <PanelMarkdown
        content={`| A | B |
|---|---|
| 1 | 2 |`}
      />
    )
    const md = getMd(container)
    expect(md.querySelector("table")).toBeInTheDocument()
    expect(md.querySelector("td")).toHaveTextContent("1")
  })

  it("renders horizontal rules", () => {
    const { container } = render(<PanelMarkdown content="---" />)
    const md = getMd(container)
    expect(md.querySelector("hr")).toBeInTheDocument()
  })

  it("renders empty content", () => {
    const { container } = render(<PanelMarkdown content="" />)
    const md = getMd(container)
    expect(md.innerHTML).toBe("")
  })

  it("updates when content changes", async () => {
    const { container, rerender } = render(<PanelMarkdown content="first" />)
    expect(getMd(container)).toHaveTextContent("first")

    rerender(<PanelMarkdown content="**second**" />)
    const md = getMd(container)
    await vi.waitFor(() => {
      expect(md.innerHTML).toContain("<strong>second</strong>")
    })
  })
})
