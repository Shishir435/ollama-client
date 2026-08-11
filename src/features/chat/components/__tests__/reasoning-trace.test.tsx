import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { ReasoningTrace } from "@/features/chat/components/reasoning-trace"
import type { ChatMessage } from "@/types"

// Mirrors i18next's JSON v4 plural resolution: the suffix is whatever
// `Intl.PluralRules` selects, not a one-vs-rest guess. Hard-coding `count === 1`
// here would pass on a catalog that breaks Russian, where 2 selects `few`.
const translate = (
  key: string,
  options?: { count?: number },
  locale = "en"
) => {
  const catalog: Record<string, string> = CATALOG
  if (options?.count === undefined) return catalog[key] ?? key
  const category = new Intl.PluralRules(locale).select(options.count)
  const value = catalog[`${key}_${category}`] ?? catalog[key] ?? key
  return value.replace("{{count}}", String(options.count))
}

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: translate })
}))

const CATALOG: Record<string, string> = {
  "chat.reasoning.aria_label": "Activity log",
  "chat.reasoning.title": "Activity",
  "chat.reasoning.debug": "Debug reasoning",
  "chat.reasoning.trace.planning": "Planning",
  "chat.reasoning.trace.preparing": "Preparing context",
  "chat.reasoning.trace.thinking": "Thinking",
  "chat.reasoning.trace.page": "Reading page",
  "chat.reasoning.trace.files": "RAG",
  "chat.reasoning.trace.web": "Searching web",
  "chat.reasoning.trace.knowledge": "RAG search",
  "chat.reasoning.trace.documents": "Reading files",
  "chat.reasoning.trace.tab": "Reading tab",
  "chat.reasoning.trace.tabs": "Listing tabs",
  "chat.reasoning.trace.selection": "Reading selection",
  "chat.reasoning.trace.trimmed": "result trimmed",
  "chat.reasoning.trace.change_limit": "Change limit",
  "chat.reasoning.trace.answering": "Answering",
  "chat.reasoning.trace.rewriting_query": "Rewriting query",
  "chat.reasoning.trace.searching_memory": "Searching memory",
  "chat.reasoning.trace.recalled_past_conversation": "Past chat recalled",
  "chat.reasoning.trace.previous_conversation": "Earlier chat",
  "chat.reasoning.trace.results_one": "{{count}} result",
  "chat.reasoning.trace.results_other": "{{count}} results",
  "tool.custom": "Custom tool"
}

vi.mock("@/components/markdown-renderer", () => ({
  MarkdownRenderer: ({ content }: { content: string }) => <div>{content}</div>
}))

const message: ChatMessage = {
  role: "assistant",
  content: "answer",
  thinking: "private reasoning detail",
  metrics: {
    ragContextLength: 120,
    ragSources: [
      { id: 1, title: "Doc", content: "content", score: 0.9, type: "file" }
    ],
    toolRuns: [
      {
        toolId: "web_search",
        label: "Web search",
        status: "done",
        startedAt: 1,
        completedAt: 2
      }
    ]
  }
}

describe("ReasoningTrace", () => {
  it("shows product trace and keeps thinking details collapsed", () => {
    render(<ReasoningTrace message={message} />)

    expect(
      screen.getByRole("button", { name: /Activity/i })
    ).toBeInTheDocument()
    expect(screen.getByText("RAG")).toBeInTheDocument()
    expect(screen.getByText("Searching web")).toBeInTheDocument()
    expect(screen.queryByText("Planning")).not.toBeInTheDocument()
    expect(screen.queryByText("Answering")).not.toBeInTheDocument()
    expect(
      screen.queryByText("private reasoning detail")
    ).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole("button", { name: /Activity/i }))
    expect(screen.getByText("Debug reasoning")).toBeInTheDocument()
    fireEvent.click(screen.getByText("Debug reasoning"))
    expect(screen.getByText("private reasoning detail")).toBeInTheDocument()
  })

  it("toggles activity details open and closed via the button", async () => {
    render(<ReasoningTrace message={message} />)

    const toggle = screen.getByRole("button", { name: /Activity/i })
    fireEvent.click(toggle)
    expect(screen.getByText("Debug reasoning")).toBeInTheDocument()
    fireEvent.click(screen.getByText("Debug reasoning"))
    expect(screen.getByText("private reasoning detail")).toBeInTheDocument()

    fireEvent.click(toggle)
    await waitFor(() =>
      expect(
        screen.queryByText("private reasoning detail")
      ).not.toBeInTheDocument()
    )
  })

  it("shows a tool step's input args and output preview when expanded", () => {
    render(
      <ReasoningTrace
        message={{
          role: "assistant",
          content: "answer",
          metrics: {
            toolRuns: [
              {
                toolId: "read_tab",
                label: "read_tab",
                status: "done",
                startedAt: 1,
                completedAt: 2,
                args: { query: "youtube" },
                resultPreview: "video transcript preview"
              }
            ]
          }
        }}
      />
    )

    // Collapsed by default for a done message; open the details.
    fireEvent.click(screen.getByRole("button", { name: /Activity/i }))
    expect(screen.getByText(/query: "youtube"/)).toBeInTheDocument()
    expect(screen.getByText(/video transcript preview/)).toBeInTheDocument()
  })

  it("shows activity event details with preview and source titles", () => {
    render(
      <ReasoningTrace
        message={{
          role: "assistant",
          content: "",
          metrics: {
            activityEvents: [
              {
                id: "rewrite",
                kind: "query_rewrite",
                label: "Rewriting query",
                status: "done",
                startedAt: 1,
                finishedAt: 2,
                inputPreview: "What about it?",
                outputPreview: "What about tool calling?"
              },
              {
                id: "search",
                kind: "searching_memory",
                label: "Searching memory",
                status: "running",
                startedAt: 3,
                inputPreview: "tool calling",
                resultCount: 2,
                sourceTitles: ["PR notes", "Tool docs"]
              }
            ]
          }
        }}
        isLoading
      />
    )

    expect(screen.getByText(/Searching memory: 2 results/)).toBeInTheDocument()
    expect(screen.getByText("What about it?")).toBeInTheDocument()
    expect(screen.getByText("What about tool calling?")).toBeInTheDocument()
    expect(screen.getByText("PR notes, Tool docs")).toBeInTheDocument()
  })

  it("translates app-generated activity previews and source titles", () => {
    render(
      <ReasoningTrace
        message={{
          role: "assistant",
          content: "",
          metrics: {
            activityEvents: [
              {
                id: "memory",
                kind: "searching_memory",
                label: "Searching memory",
                status: "done",
                startedAt: 1,
                outputPreview: {
                  text: "Recalled past conversation context",
                  textKey: "chat.reasoning.trace.recalled_past_conversation"
                },
                sourceTitles: [
                  {
                    text: "Previous conversation",
                    textKey: "chat.reasoning.trace.previous_conversation"
                  },
                  "User note"
                ]
              }
            ]
          }
        }}
        isLoading
      />
    )

    expect(screen.getAllByText("Past chat recalled").length).toBeGreaterThan(0)
    expect(screen.getByText("Earlier chat, User note")).toBeInTheDocument()
  })

  it("renders a persisted labelKey instead of the label it shipped with", () => {
    render(
      <ReasoningTrace
        message={{
          role: "assistant",
          content: "",
          metrics: {
            activityEvents: [
              {
                id: "rewrite",
                kind: "query_rewrite",
                // What the producing device wrote. A reader on another locale
                // must not see it.
                label: "Rewriting query",
                labelKey: "chat.reasoning.trace.rewriting_query",
                status: "running",
                startedAt: 1
              }
            ]
          }
        }}
        isLoading
      />
    )

    expect(screen.getAllByText("Rewriting query").length).toBeGreaterThan(0)
  })

  it("falls back to the stored label when an old event has no labelKey", () => {
    render(
      <ReasoningTrace
        message={{
          role: "assistant",
          content: "",
          metrics: {
            activityEvents: [
              {
                id: "legacy",
                kind: "searching_files",
                label: "Searching files",
                status: "done",
                startedAt: 1,
                finishedAt: 2,
                resultCount: 1
              }
            ]
          }
        }}
      />
    )

    fireEvent.click(screen.getByRole("button", { name: /Activity/ }))
    expect(screen.getAllByText("Searching files").length).toBeGreaterThan(0)
    expect(screen.getAllByText(/1 result$/).length).toBeGreaterThan(0)
  })

  it("links trimmed tool results to the exact context limit setting", () => {
    render(
      <ReasoningTrace
        message={{
          role: "assistant",
          content: "answer",
          metrics: {
            toolRuns: [
              {
                toolId: "read_tab",
                label: "read_tab",
                status: "done",
                startedAt: 1,
                completedAt: 2,
                truncated: true
              }
            ]
          }
        }}
      />
    )

    fireEvent.click(screen.getByRole("button", { name: /Activity/i }))
    expect(screen.getByText(/result trimmed/)).toBeInTheDocument()
    expect(
      screen.getByRole("button", { name: "Change limit" })
    ).toBeInTheDocument()
  })

  it("keeps live raw provider reasoning behind debug details", () => {
    render(
      <ReasoningTrace
        message={{ role: "assistant", content: "", thinking: "live thoughts" }}
        isStreaming
      />
    )
    expect(screen.queryByText("live thoughts")).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: /Activity/i }))
    fireEvent.click(screen.getByText("Debug reasoning"))
    expect(screen.getByText("live thoughts")).toBeInTheDocument()
  })

  it("keeps streamed provider reasoning hidden until debug is opened", async () => {
    const { rerender } = render(
      <ReasoningTrace message={{ role: "assistant", content: "" }} isLoading />
    )

    expect(screen.queryByText("streamed thought")).not.toBeInTheDocument()

    rerender(
      <ReasoningTrace
        message={{
          role: "assistant",
          content: "",
          thinking: "streamed thought"
        }}
        isStreaming
      />
    )

    await waitFor(() =>
      expect(screen.queryByText("streamed thought")).not.toBeInTheDocument()
    )
    fireEvent.click(screen.getByRole("button", { name: /Activity/i }))
    fireEvent.click(screen.getByText("Debug reasoning"))
    expect(screen.getByText("streamed thought")).toBeInTheDocument()
  })

  it("keeps thinking-only fallback raw reasoning behind debug details", async () => {
    render(
      <ReasoningTrace
        message={{
          role: "assistant",
          content:
            "I did not receive a final answer from the model. Please try again.",
          thinking: "reasoning that should stay in the trace",
          metrics: {
            thinkingOnlyResponse: true
          }
        }}
      />
    )

    await waitFor(() =>
      expect(
        screen.getByText("reasoning that should stay in the trace")
      ).not.toBeVisible()
    )
    fireEvent.click(screen.getByText("Debug reasoning"))
    expect(
      screen.getByText("reasoning that should stay in the trace")
    ).toBeInTheDocument()
  })

  it("keeps thought details for done thinking messages without live answering state", () => {
    render(
      <ReasoningTrace
        message={{
          role: "assistant",
          content: "answer",
          thinking: "short thought"
        }}
      />
    )

    expect(
      screen.getByRole("button", { name: /Activity/i })
    ).toBeInTheDocument()
    expect(screen.queryByText("Answering")).not.toBeInTheDocument()
    expect(screen.queryByText("Searching web")).not.toBeInTheDocument()
    expect(screen.queryByText("RAG")).not.toBeInTheDocument()
  })

  it("shows page only when actual selected page context was sent", () => {
    render(
      <ReasoningTrace
        message={{
          role: "assistant",
          content: "",
          metrics: {
            usedContextChunks: [
              {
                id: 1,
                title: "File chunk",
                excerpt: "file text",
                score: 0.8,
                source: "rag"
              }
            ],
            ragContextLength: 100
          }
        }}
      />
    )

    expect(screen.queryByText("Reading page")).not.toBeInTheDocument()
    expect(screen.getByText("RAG")).toBeInTheDocument()
  })

  it("keeps durable page and RAG icons after message is done", () => {
    render(
      <ReasoningTrace
        message={{
          role: "assistant",
          content: "answer",
          metrics: {
            tabContextLength: 50,
            ragContextLength: 100,
            usedContextChunks: [
              {
                id: 1,
                title: "Page",
                excerpt: "page text",
                score: 0.9,
                source: "tab"
              }
            ]
          }
        }}
      />
    )

    expect(screen.getByText("Reading page")).toBeInTheDocument()
    expect(screen.getByText("RAG")).toBeInTheDocument()
    expect(screen.queryByText("Answering")).not.toBeInTheDocument()
  })

  it("shows thinking while busy before visible answer text", () => {
    render(
      <ReasoningTrace message={{ role: "assistant", content: "" }} isLoading />
    )

    expect(screen.getAllByText("Preparing context").length).toBeGreaterThan(0)
    expect(screen.queryByText("Answering")).not.toBeInTheDocument()
  })

  it("shows answering while visible text is streaming", () => {
    render(
      <ReasoningTrace
        message={{ role: "assistant", content: "partial answer" }}
        isStreaming
      />
    )

    expect(screen.getAllByText("Answering").length).toBeGreaterThan(0)
    expect(screen.queryByText("Preparing context")).not.toBeInTheDocument()
  })

  it("shows provider-agnostic tool labels and error detail", () => {
    render(
      <ReasoningTrace
        message={{
          role: "assistant",
          content: "",
          metrics: {
            toolRuns: [
              {
                toolId: "rag-search",
                label: "RAG search",
                status: "error",
                startedAt: 10,
                error: "No indexed files"
              }
            ]
          }
        }}
      />
    )

    fireEvent.mouseOver(screen.getAllByText("RAG search")[0])

    return waitFor(() => {
      expect(
        screen.getByText("RAG search: No indexed files")
      ).toBeInTheDocument()
    })
  })

  it("uses tool run display metadata when present", () => {
    render(
      <ReasoningTrace
        message={{
          role: "assistant",
          content: "answer",
          metrics: {
            toolRuns: [
              {
                toolId: "external_tool",
                label: "external_tool",
                displayNameKey: "tool.custom",
                iconKey: "search",
                status: "done",
                startedAt: 1,
                completedAt: 2
              }
            ]
          }
        }}
      />
    )

    expect(screen.getByText("Custom tool")).toBeInTheDocument()
  })

  it("collapses multiple web search runs into one compact chip", () => {
    render(
      <ReasoningTrace
        message={{
          role: "assistant",
          content: "answer",
          metrics: {
            toolRuns: [
              {
                toolId: "web_search",
                label: "web_search",
                status: "done",
                startedAt: 1
              },
              {
                toolId: "web_search",
                label: "web_search",
                status: "done",
                startedAt: 2
              },
              {
                toolId: "web_search",
                label: "web_search",
                status: "done",
                startedAt: 3
              },
              {
                toolId: "web_search",
                label: "web_search",
                status: "done",
                startedAt: 4
              }
            ]
          }
        }}
      />
    )

    expect(screen.getAllByText("Searching web")).toHaveLength(1)
    expect(screen.queryByText(/4 searches/)).not.toBeInTheDocument()
  })

  it("does not pin a recovered tool error as the active label after answer text exists", () => {
    render(
      <ReasoningTrace
        message={{
          role: "assistant",
          content: "answer",
          metrics: {
            toolRuns: [
              {
                toolId: "read_tab",
                label: "Reading tab",
                status: "error",
                startedAt: 1,
                completedAt: 2,
                error: "No open tab has id 2."
              },
              {
                toolId: "list_tabs",
                label: "Listing tabs",
                status: "done",
                startedAt: 3,
                completedAt: 4,
                resultPreview: "id=7: Docs"
              }
            ]
          }
        }}
      />
    )

    expect(
      screen.queryByText(/Reading tab: No open tab/)
    ).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole("button", { name: /Activity/i }))
    expect(screen.getByText("No open tab has id 2.")).toBeInTheDocument()
  })
})
