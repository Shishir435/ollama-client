// @vitest-environment jsdom

import { act, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { openExternalUrl, openOptionsInTab } from "@/lib/browser-api"
import { logger } from "@/lib/logger"
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
        "chat.actions.download": "Download",
        "chat.remote_image.blocked": "Remote image blocked",
        "chat.remote_image.load": "Load image"
      })[key] ?? key
  })
}))

describe("MarkdownRenderer", () => {
  it.each([
    "![Tracker](https://example.com/tracker.png)",
    '<img src="https://example.com/tracker.png" alt="Tracker">',
    '<img src="/&#9;/example.com/tracker.png" alt="Tracker">',
    '<img src="&#92;&#92;example.com/tracker.png" alt="Tracker">',
    '<img src="data:image/png;base64,AA==" srcset="https://example.com/tracker.png 2x" alt="Tracker">',
    '<picture><source srcset="https://example.com/other.png"><img src="//example.com/tracker.png" alt="Tracker"></picture>'
  ])("requires consent before loading an image: %s", (content) => {
    const { container } = render(<MarkdownRenderer content={content} />)
    expect(container.querySelector("img")).toBeNull()
    const button = screen.getByRole("button", { name: "Load image" })
    fireEvent.click(button)
    expect(container.querySelector("img")).toHaveAttribute(
      "src",
      "https://example.com/tracker.png"
    )
    expect(container.querySelector("img")).toHaveAttribute(
      "referrerpolicy",
      "no-referrer"
    )
    expect(container.querySelector("[srcset]")).toBeNull()
  })

  it.each([
    "data:image/png;base64,AA==",
    "blob:https://example.com/local",
    "chrome-extension://extension/image.png",
    "/assets/image.png"
  ])("keeps local images: %s", (src) => {
    const { container } = render(
      <MarkdownRenderer content={`<img src="${src}" alt="Local">`} />
    )
    expect(container.querySelector("img")).toHaveAttribute("src", src)
    expect(screen.queryByRole("button", { name: "Load image" })).toBeNull()
  })

  it("does not reuse image consent for a changed URL during streaming", () => {
    vi.useFakeTimers()
    try {
      const { container, rerender } = render(
        <MarkdownRenderer content="![Image](https://example.com/one.png)" />
      )
      fireEvent.click(screen.getByRole("button", { name: "Load image" }))
      expect(container.querySelector("img")).toHaveAttribute(
        "src",
        "https://example.com/one.png"
      )
      rerender(
        <MarkdownRenderer content="![Image](https://example.com/two.png)" />
      )
      act(() => {
        vi.advanceTimersByTime(200)
      })
      expect(container.querySelector("img")).toBeNull()
      expect(
        screen.getByRole("button", { name: "Load image" })
      ).toBeInTheDocument()
    } finally {
      vi.useRealTimers()
    }
  })

  it("blocks alternative image loads in CSS, SVG and image inputs", () => {
    const { container } = render(
      <MarkdownRenderer
        content={
          '<span style="background:url(https://example.com/css)">text</span><svg><image href="https://example.com/svg"/><path fill="url(https://example.com/paint)"/></svg><input type="image" src="https://example.com/input"><video poster="https://example.com/poster"></video>'
        }
      />
    )
    expect(
      container.querySelector("[style], image, [src], [poster], [fill]")
    ).toBeNull()
  })

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

  it("preserves supported SVG drawing attributes", () => {
    const { container } = render(
      <MarkdownRenderer
        content={
          '<svg viewBox="0 0 24 24"><path d="M2 2L22 22" fill="none" stroke="red" stroke-width="2"/><polygon points="0,0 10,10 0,20"/></svg>'
        }
      />
    )

    const svg = container.querySelector("svg")
    const path = container.querySelector("path")
    const polygon = container.querySelector("polygon")
    expect(svg).toHaveAttribute("viewBox", "0 0 24 24")
    expect(path).toHaveAttribute("d", "M2 2L22 22")
    expect(path).toHaveAttribute("fill", "none")
    expect(path).toHaveAttribute("stroke-width", "2")
    expect(polygon).toHaveAttribute("points", "0,0 10,10 0,20")
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

  it("uses the latest streamed code for preview and copy actions", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText }
    })
    const { rerender, container } = render(
      <MarkdownRenderer
        content={"```html\n<section>Partial answer</section>\n```"}
      />
    )
    await screen.findByRole("button", { name: "Preview HTML artifact 1" })

    rerender(
      <MarkdownRenderer
        content={"```html\n<section>Complete answer</section>\n```"}
      />
    )
    await waitFor(() => {
      expect(container).toHaveTextContent("Complete answer")
    })
    fireEvent.click(screen.getByRole("button", { name: "Copy" }))
    expect(writeText).toHaveBeenCalledWith(
      "<section>Complete answer</section>\n"
    )

    fireEvent.click(
      screen.getByRole("button", { name: "Preview HTML artifact 1" })
    )
    const iframe = await screen.findByTitle("HTML artifact 1")
    expect(iframe).toHaveAttribute(
      "srcDoc",
      expect.stringContaining("Complete answer")
    )
  })

  it("keeps copy inactive and logs when the clipboard rejects", async () => {
    const error = new Error("clipboard permission denied")
    const writeText = vi.fn().mockRejectedValue(error)
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText }
    })
    const loggerError = vi.spyOn(logger, "error").mockImplementation(() => {})

    render(
      <MarkdownRenderer content={"\x60\x60\x60\nplain notes\n\x60\x60\x60"} />
    )
    const copyButton = await screen.findByRole("button", { name: "Copy" })
    fireEvent.click(copyButton)

    await waitFor(() => {
      expect(loggerError).toHaveBeenCalledWith(
        "Clipboard write failed",
        "MarkdownCodeBlock",
        { error }
      )
    })
    expect(screen.getByRole("button", { name: "Copy" })).toBeInTheDocument()
    loggerError.mockRestore()
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

  describe("streamed content", () => {
    it("settles on the final content instead of an intermediate parse", () => {
      vi.useFakeTimers()
      try {
        const { container, rerender } = render(
          <MarkdownRenderer content={"Streaming"} />
        )

        rerender(<MarkdownRenderer content={"Streaming ans"} />)
        rerender(<MarkdownRenderer content={"Streaming answ"} />)
        rerender(<MarkdownRenderer content={"Streaming **answer**."} />)
        act(() => {
          vi.advanceTimersByTime(500)
        })

        const surface = container.querySelector(".markdown-container")
        expect(surface).toHaveTextContent("Streaming answer.")
        expect(surface?.querySelector("strong")).toHaveTextContent("answer")
      } finally {
        vi.useRealTimers()
      }
    })
  })
})
