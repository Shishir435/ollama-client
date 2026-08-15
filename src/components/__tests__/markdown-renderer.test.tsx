// @vitest-environment jsdom

import { act, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { openExternalUrl, openOptionsInTab } from "@/lib/browser-api"
import { MarkdownRenderer } from "../markdown-renderer"

vi.mock("@/lib/browser-api", () => ({
  openExternalUrl: vi.fn(),
  openOptionsInTab: vi.fn(),
  // Mirrors runtime.getURL: an absolute URL on the origin the page already runs
  // on. DOMPurify strips literal chrome-extension: hrefs, so the only links that
  // reach the handler are relative ones resolved against that same origin.
  runtime: {
    getURL: (path: string) => new URL(path, globalThis.location.href).toString()
  }
}))

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

  describe("fragment links", () => {
    const FOOTNOTE_MARKDOWN = "Claim.[^1]\n\n[^1]: Supporting note."
    // jsdom does not implement scrollIntoView. One prototype spy serves every
    // element, so assertions read `mock.contexts` to identify the receiver.
    const scrollIntoView = vi.fn()

    beforeEach(() => {
      vi.clearAllMocks()
      Element.prototype.scrollIntoView = scrollIntoView
    })

    it("scrolls to a footnote instead of opening the page in a tab", () => {
      const { container } = render(
        <MarkdownRenderer content={FOOTNOTE_MARKDOWN} />
      )

      const reference =
        container.querySelector<HTMLAnchorElement>('a[href="#fn1"]')
      expect(reference).toBeInTheDocument()

      fireEvent.click(reference as HTMLAnchorElement)

      expect(openExternalUrl).not.toHaveBeenCalled()
      expect(openOptionsInTab).not.toHaveBeenCalled()
      expect(scrollIntoView).toHaveBeenCalledWith({ block: "center" })
      expect(scrollIntoView.mock.contexts[0]).toBe(
        container.querySelector("#fn1")
      )
    })

    it("scrolls back to the reference from the footnote backlink", () => {
      const { container } = render(
        <MarkdownRenderer content={FOOTNOTE_MARKDOWN} />
      )

      const backlink =
        container.querySelector<HTMLAnchorElement>('a[href="#fnref1"]')
      expect(backlink).toBeInTheDocument()

      fireEvent.click(backlink as HTMLAnchorElement)

      expect(openExternalUrl).not.toHaveBeenCalled()
      expect(scrollIntoView.mock.contexts[0]).toBe(
        container.querySelector("#fnref1")
      )
    })

    it("resolves a footnote within its own message, not an earlier one", () => {
      const first = render(<MarkdownRenderer content={FOOTNOTE_MARKDOWN} />)
      const second = render(<MarkdownRenderer content={FOOTNOTE_MARKDOWN} />)

      const reference =
        second.container.querySelector<HTMLAnchorElement>('a[href="#fn1"]')
      fireEvent.click(reference as HTMLAnchorElement)

      expect(scrollIntoView).toHaveBeenCalledTimes(1)
      expect(scrollIntoView.mock.contexts[0]).toBe(
        second.container.querySelector("#fn1")
      )
      expect(scrollIntoView.mock.contexts[0]).not.toBe(
        first.container.querySelector("#fn1")
      )
    })

    it("does not open a tab for an anchor with no target in the message", () => {
      const { container } = render(
        <MarkdownRenderer content={"[missing](#no-such-anchor)"} />
      )

      fireEvent.click(container.querySelector("a") as HTMLAnchorElement)

      expect(openExternalUrl).not.toHaveBeenCalled()
      expect(openOptionsInTab).not.toHaveBeenCalled()
      expect(scrollIntoView).not.toHaveBeenCalled()
    })

    it("does not open a tab for a bare '#' anchor", () => {
      const { container } = render(<MarkdownRenderer content={"[top](#)"} />)

      fireEvent.click(container.querySelector("a") as HTMLAnchorElement)

      expect(openExternalUrl).not.toHaveBeenCalled()
      expect(openOptionsInTab).not.toHaveBeenCalled()
    })

    it("does not open a tab for a footnote clicked before its note streams in", () => {
      // Mid-stream the reference exists but the footnote block does not yet.
      const { container } = render(
        <MarkdownRenderer content={'Claim.<a href="#fn1">1</a>'} />
      )

      fireEvent.click(container.querySelector("a") as HTMLAnchorElement)

      expect(openExternalUrl).not.toHaveBeenCalled()
      expect(scrollIntoView).not.toHaveBeenCalled()
    })

    it("resolves a percent-encoded fragment against the decoded id", () => {
      const { container } = render(
        <MarkdownRenderer
          content={'<a href="#f%C3%BC">ref</a><p id="fü">target</p>'}
        />
      )

      fireEvent.click(container.querySelector("a") as HTMLAnchorElement)

      expect(scrollIntoView.mock.contexts[0]).toBe(
        container.querySelector("#fü")
      )
    })

    it("does not route a sibling path that merely starts with options.html", () => {
      const { container } = render(
        <MarkdownRenderer content={"[spoof](options.html.evil)"} />
      )

      fireEvent.click(container.querySelector("a") as HTMLAnchorElement)

      expect(openOptionsInTab).not.toHaveBeenCalled()
      expect(openExternalUrl).toHaveBeenCalledWith(
        new URL("options.html.evil", globalThis.location.href).toString()
      )
    })

    it("highlights the footnote it scrolled to, then clears it", () => {
      vi.useFakeTimers()
      try {
        const { container } = render(
          <MarkdownRenderer content={FOOTNOTE_MARKDOWN} />
        )
        const footnote = container.querySelector("#fn1")

        fireEvent.click(
          container.querySelector('a[href="#fn1"]') as HTMLAnchorElement
        )
        expect(footnote).toHaveClass("fragment-target")

        act(() => {
          vi.advanceTimersByTime(1800)
        })
        expect(footnote).not.toHaveClass("fragment-target")
      } finally {
        vi.useRealTimers()
      }
    })

    it("moves the highlight when a second footnote is clicked", () => {
      vi.useFakeTimers()
      try {
        const { container } = render(
          <MarkdownRenderer
            content={"A.[^1] B.[^2]\n\n[^1]: First.\n[^2]: Second."}
          />
        )

        fireEvent.click(
          container.querySelector('a[href="#fn1"]') as HTMLAnchorElement
        )
        fireEvent.click(
          container.querySelector('a[href="#fn2"]') as HTMLAnchorElement
        )

        expect(container.querySelector("#fn1")).not.toHaveClass(
          "fragment-target"
        )
        expect(container.querySelector("#fn2")).toHaveClass("fragment-target")
      } finally {
        vi.useRealTimers()
      }
    })

    it("drops a pending highlight timer on unmount", () => {
      vi.useFakeTimers()
      try {
        const { container, unmount } = render(
          <MarkdownRenderer content={FOOTNOTE_MARKDOWN} />
        )

        fireEvent.click(
          container.querySelector('a[href="#fn1"]') as HTMLAnchorElement
        )
        unmount()

        expect(() => vi.advanceTimersByTime(1800)).not.toThrow()
        expect(vi.getTimerCount()).toBe(0)
      } finally {
        vi.useRealTimers()
      }
    })

    it("leaves a same-document link with no fragment on the tab path", () => {
      const here = globalThis.location.pathname.replace(/^\//, "")
      const { container } = render(
        <MarkdownRenderer content={`[reload](${here || "."})`} />
      )

      fireEvent.click(container.querySelector("a") as HTMLAnchorElement)

      expect(openExternalUrl).toHaveBeenCalled()
      expect(scrollIntoView).not.toHaveBeenCalled()
    })

    it("still opens external links in a tab", () => {
      const { container } = render(
        <MarkdownRenderer content={"[docs](https://example.com/docs)"} />
      )

      fireEvent.click(container.querySelector("a") as HTMLAnchorElement)

      expect(openExternalUrl).toHaveBeenCalledWith("https://example.com/docs")
    })

    it("keeps settings deep links routed to the options page", () => {
      const { container } = render(
        <MarkdownRenderer
          content={
            "[open settings](options.html?tab=models&focus=provider-settings)"
          }
        />
      )

      fireEvent.click(container.querySelector("a") as HTMLAnchorElement)

      expect(openOptionsInTab).toHaveBeenCalledWith(
        new URL(
          "options.html?tab=models&focus=provider-settings",
          globalThis.location.href
        ).toString()
      )
      expect(openExternalUrl).not.toHaveBeenCalled()
    })

    it("keeps an options deep link routed even when rendered on that page", () => {
      const originalPath = `${globalThis.location.pathname}${globalThis.location.search}`
      // Simulate the renderer mounting inside the options page itself, where a
      // fragment deep link resolves to the same document.
      globalThis.history.pushState({}, "", "/options.html")

      try {
        const { container } = render(
          <MarkdownRenderer content={"[privacy](options.html#/privacy)"} />
        )

        fireEvent.click(container.querySelector("a") as HTMLAnchorElement)

        expect(openOptionsInTab).toHaveBeenCalledWith(
          new URL("options.html#/privacy", globalThis.location.href).toString()
        )
      } finally {
        globalThis.history.pushState({}, "", originalPath)
      }
    })
  })
})
