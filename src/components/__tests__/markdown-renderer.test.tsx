// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { MarkdownRenderer } from "../markdown-renderer"

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) =>
      ({
        "chat.actions.copy": "Copy",
        "chat.actions.copied": "Copied",
        "chat.actions.preview": "Preview",
        "chat.actions.download": "Download"
      })[key] ?? key
  })
}))

describe("MarkdownRenderer", () => {
  it("renders inline code as a visible semantic code span", () => {
    const { container } = render(
      <MarkdownRenderer content={"Use `some` in this sentence."} />
    )

    const surface = container.querySelector(".markdown-container")
    const inlineCode = surface?.querySelector("code")

    expect(surface).toHaveClass("typeset", "typeset-chat")
    expect(surface).not.toHaveClass("prose")
    expect(inlineCode).toHaveTextContent("some")
    expect(inlineCode?.closest("pre")).toBeNull()
  })

  it("renders the useful Markdown syntax supported by the chat parser", () => {
    const markdown = [
      "# Heading",
      "",
      "**bold** *emphasis* ~~removed~~ ==marked== H~2~O x^2^ :smile:",
      "",
      "> quoted",
      "",
      "- item",
      "- [x] complete",
      "",
      "1. first",
      "",
      "[safe link](https://example.com)",
      "",
      "---",
      "",
      "| Name | Value |",
      "| --- | --- |",
      "| A | B |",
      "",
      "Term",
      ": Definition",
      "",
      "A footnote.[^1]",
      "",
      "[^1]: Footnote text.",
      "",
      "::: info",
      "Helpful information.",
      ":::",
      "",
      "::: warning",
      "Take care.",
      ":::"
    ].join("\n")

    const { container } = render(<MarkdownRenderer content={markdown} />)
    const surface = container.querySelector(".markdown-container")

    expect(surface?.querySelector("h1")).toHaveTextContent("Heading")
    expect(surface?.querySelector("strong")).toHaveTextContent("bold")
    expect(surface?.querySelector("em")).toHaveTextContent("emphasis")
    expect(surface?.querySelector("s")).toHaveTextContent("removed")
    expect(surface?.querySelector("mark")).toHaveTextContent("marked")
    expect(surface?.querySelector("sub")).toHaveTextContent("2")
    expect(surface?.querySelector("sup")).toBeInTheDocument()
    expect(surface).toHaveTextContent("😄")
    expect(surface?.querySelector("blockquote")).toHaveTextContent("quoted")
    expect(surface?.querySelector("ul.contains-task-list")).toBeInTheDocument()
    expect(
      surface?.querySelector("input.task-list-item-checkbox")
    ).toBeChecked()
    expect(surface?.querySelector("ol")).toHaveTextContent("first")
    expect(
      surface?.querySelector('a[href="https://example.com"]')
    ).toHaveTextContent("safe link")
    expect(surface?.querySelector("hr")).toBeInTheDocument()
    expect(surface?.querySelector("table")).toHaveTextContent("Value")
    expect(surface?.querySelector("dl")).toHaveTextContent("Definition")
    expect(surface?.querySelector(".footnotes")).toHaveTextContent(
      "Footnote text."
    )
    expect(surface?.querySelector(".info")).toHaveTextContent(
      "Helpful information."
    )
    expect(surface?.querySelector(".warning")).toHaveTextContent("Take care.")
  })

  it("keeps useful raw HTML while sanitizing executable content", () => {
    const { container } = render(
      <MarkdownRenderer
        content={
          '<details open><summary>More</summary>Safe</details><script>alert(1)</script><a href="javascript:alert(2)">unsafe</a>'
        }
      />
    )

    expect(container.querySelector("details[open]")).toHaveTextContent(
      "MoreSafe"
    )
    expect(container.querySelector("script")).toBeNull()
    expect(container.querySelector("a")).not.toHaveAttribute("href")
  })

  it("adds copy and preview controls to renderable code blocks", async () => {
    render(
      <MarkdownRenderer
        content={"```html\n<section>Hello preview</section>\n```"}
      />
    )

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Copy" })).toBeInTheDocument()
      expect(
        screen.getByRole("button", { name: "Preview HTML artifact 1" })
      ).toBeInTheDocument()
    })
    const preview = screen.getByRole("button", {
      name: "Preview HTML artifact 1"
    })

    fireEvent.click(preview)

    const iframe = await screen.findByTitle("HTML artifact 1")
    expect(iframe).toHaveAttribute("sandbox", "allow-scripts")
    expect(iframe).toHaveAttribute(
      "srcDoc",
      expect.stringContaining("Hello preview")
    )
  })

  it("does not add preview to plain code blocks", async () => {
    render(<MarkdownRenderer content={"```\njust notes\n```"} />)

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Copy" })).toBeInTheDocument()
    })
    expect(
      screen.queryByRole("button", { name: /Preview/ })
    ).not.toBeInTheDocument()
  })

  it("adds a download control to code artifacts (no preview required)", async () => {
    render(<MarkdownRenderer content={"```ts\nconst a = 1\n```"} />)

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: /Download/ })
      ).toBeInTheDocument()
    })
    expect(
      screen.queryByRole("button", { name: /Preview/ })
    ).not.toBeInTheDocument()
  })

  it("numbers previews by artifacts, not all code blocks", async () => {
    render(
      <MarkdownRenderer
        content={"```\nplain notes\n```\n\n```html\n<section>Hi</section>\n```"}
      />
    )

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "Preview HTML artifact 1" })
      ).toBeInTheDocument()
    })
  })
})
