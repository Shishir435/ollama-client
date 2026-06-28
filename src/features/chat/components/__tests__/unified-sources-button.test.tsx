import { render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { UnifiedSourcesButton } from "@/features/chat/components/unified-sources-button"

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, values?: { count?: number }) =>
      ({
        "chat.sources.unified_tooltip": `${values?.count} sources`,
        "chat.sources.unified_aria": `View ${values?.count} sources`,
        "chat.sources.unified_title": `Sources (${values?.count})`,
        "chat.sources.unified_page": `Page & tabs (${values?.count})`,
        "chat.sources.unified_knowledge": `Knowledge (${values?.count})`,
        "chat.sources.unified_web": `Web (${values?.count})`,
        "chat.sources.web_unused_label": `Also found (${values?.count})`,
        "chat.sources.char_counts": "counts",
        "chat.sources.trimmed": "trimmed",
        "chat.sources.web_unused_hint": "unused hint",
        "chat.sources.web_no_snippet": "No preview"
      })[key] ?? key
  })
}))

vi.mock("@/features/chat/components/unified-sources-sheet", () => ({
  UnifiedSourcesSheet: ({
    title,
    sections
  }: {
    title: string
    sections: { label: string; items: { title: string }[] }[]
  }) => (
    <div>
      <h2>{title}</h2>
      {sections.map((section) => (
        <section key={section.label}>
          <h3>{section.label}</h3>
          {section.items.map((item) => (
            <span key={item.title}>{item.title}</span>
          ))}
        </section>
      ))}
    </div>
  )
}))

describe("UnifiedSourcesButton", () => {
  it("groups page, knowledge, and web results behind one source surface", () => {
    render(
      <UnifiedSourcesButton
        ragSources={[
          {
            id: "rag-1",
            title: "Report",
            content: "knowledge",
            score: 0.9
          }
        ]}
        usedContextChunks={[
          {
            id: "tab-1",
            title: "Current page",
            excerpt: "page",
            score: 0.8,
            source: "tab"
          }
        ]}
        toolRuns={
          [
            {
              toolId: "web_search",
              category: "web",
              sources: [
                {
                  id: "web-1",
                  title: "News",
                  url: "https://news.test",
                  excerpt: "news",
                  used: true
                },
                {
                  id: "web-2",
                  title: "Extra",
                  url: "https://extra.test",
                  excerpt: "extra",
                  used: false
                }
              ]
            }
          ] as never
        }
      />
    )

    expect(screen.getByText("Sources (4)")).toBeInTheDocument()
    expect(screen.getByText("Page & tabs (1)")).toBeInTheDocument()
    expect(screen.getByText("Knowledge (1)")).toBeInTheDocument()
    expect(screen.getByText("Web (1)")).toBeInTheDocument()
    expect(screen.getByText("Also found (1)")).toBeInTheDocument()
  })
})
