import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import type { ToolRun } from "@/types"
import { WebSearchSourcesButton } from "../web-search-sources-button"

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, vars?: Record<string, unknown>) =>
      vars ? `${key} ${JSON.stringify(vars)}` : key
  })
}))

const webRun = (sources: ToolRun["sources"]): ToolRun => ({
  toolId: "web_search",
  label: "Web search",
  category: "web",
  status: "done",
  startedAt: 0,
  sources
})

describe("WebSearchSourcesButton", () => {
  it("renders nothing without web-search sources", () => {
    const { container } = render(<WebSearchSourcesButton toolRuns={[]} />)
    expect(container).toBeEmptyDOMElement()
  })

  it("ignores non-web tool runs", () => {
    const run: ToolRun = {
      toolId: "rag_search",
      label: "RAG",
      category: "knowledge",
      status: "done",
      startedAt: 0,
      sources: [{ title: "x", url: "https://x.com", used: true }]
    }
    const { container } = render(<WebSearchSourcesButton toolRuns={[run]} />)
    expect(container).toBeEmptyDOMElement()
  })

  it("opens the sheet and splits used vs also-found", () => {
    const run = webRun([
      { title: "Used A", url: "https://a.com", excerpt: "ea", used: true },
      { title: "Used B", url: "https://b.com", excerpt: "eb", used: true },
      { title: "Extra C", url: "https://c.com", excerpt: "ec", used: false }
    ])
    render(<WebSearchSourcesButton toolRuns={[run]} />)

    // Badge/tooltip reflect the total found (3).
    fireEvent.click(screen.getByRole("button"))

    expect(
      screen.getByText('chat.sources.web_used_label {"count":2}')
    ).toBeInTheDocument()
    expect(
      screen.getByText('chat.sources.web_unused_label {"count":1}')
    ).toBeInTheDocument()
    expect(screen.getByText("Used A")).toBeInTheDocument()
    expect(screen.getByText("Extra C")).toBeInTheDocument()
  })

  it("renders one verifiable host link per source in the row (no duplicate)", () => {
    const run = webRun([
      { title: "Used A", url: "https://a.com/page", excerpt: "ea", used: true }
    ])
    render(<WebSearchSourcesButton toolRuns={[run]} />)
    fireEvent.click(screen.getByRole("button"))

    const links = screen.getAllByRole("link", { name: /a\.com/ })
    expect(links).toHaveLength(1)
    expect(links[0]).toHaveAttribute("href", "https://a.com/page")
    expect(links[0]).toHaveAttribute("target", "_blank")
    expect(links[0]).toHaveAttribute("title", "https://a.com/page")
  })

  it("shows backend metadata (engine, score, date) and snippet in the dropdown", () => {
    const run = webRun([
      {
        title: "Dated source",
        url: "https://a.com/page",
        excerpt: "the snippet text",
        publishedAt: "2026-06-02",
        source: "duckduckgo",
        score: 0.87,
        used: true
      }
    ])
    render(<WebSearchSourcesButton toolRuns={[run]} />)
    fireEvent.click(screen.getByRole("button"))
    // Expand the accordion row.
    fireEvent.click(screen.getByText("Dated source"))

    expect(screen.getByText(/2026-06-02/)).toBeInTheDocument()
    expect(screen.getByText(/duckduckgo/)).toBeInTheDocument()
    expect(screen.getByText(/0\.87/)).toBeInTheDocument()
    expect(screen.getByText("the snippet text")).toBeInTheDocument()
  })
})
