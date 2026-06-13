import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { ReasoningTrace } from "@/features/chat/components/reasoning-trace"
import type { ChatMessage } from "@/types"

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) =>
      ({
        "chat.reasoning.aria_label": "Model reasoning",
        "chat.reasoning.title": "Thought Process",
        "chat.reasoning.trace.planning": "Planning",
        "chat.reasoning.trace.thinking": "Thinking",
        "chat.reasoning.trace.page": "Reading page",
        "chat.reasoning.trace.files": "RAG",
        "chat.reasoning.trace.web": "Searching web",
        "chat.reasoning.trace.answering": "Answering"
      })[key] ?? key
  })
}))

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
        toolId: "web-search",
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
      screen.getByRole("button", { name: /Thought Process/i })
    ).toBeInTheDocument()
    expect(screen.getByText("RAG")).toBeInTheDocument()
    expect(screen.getByText("Searching web")).toBeInTheDocument()
    expect(screen.queryByText("Planning")).not.toBeInTheDocument()
    expect(screen.queryByText("Answering")).not.toBeInTheDocument()
    expect(
      screen.queryByText("private reasoning detail")
    ).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole("button", { name: /Thought Process/i }))
    expect(screen.getByText("private reasoning detail")).toBeInTheDocument()
  })

  it("toggles thinking details open and closed via the button", async () => {
    render(<ReasoningTrace message={message} />)

    const toggle = screen.getByRole("button", { name: /Thought Process/i })
    fireEvent.click(toggle)
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
    fireEvent.click(screen.getByRole("button", { name: /Thought Process/i }))
    expect(screen.getByText(/query: "youtube"/)).toBeInTheDocument()
    expect(screen.getByText(/video transcript preview/)).toBeInTheDocument()
  })

  it("auto-expands live reasoning while thinking (no answer yet)", () => {
    render(
      <ReasoningTrace
        message={{ role: "assistant", content: "", thinking: "live thoughts" }}
        isStreaming
      />
    )
    // Visible inline, without any click, while the model is still thinking.
    expect(screen.getByText("live thoughts")).toBeInTheDocument()
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
      screen.getByRole("button", { name: /Thought Process/i })
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
          content: "answer",
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

    expect(screen.getAllByText("Thinking...").length).toBeGreaterThan(0)
    expect(screen.queryByText("Answering...")).not.toBeInTheDocument()
  })

  it("shows answering while visible text is streaming", () => {
    render(
      <ReasoningTrace
        message={{ role: "assistant", content: "partial answer" }}
        isStreaming
      />
    )

    expect(screen.getAllByText("Answering...").length).toBeGreaterThan(0)
    expect(screen.queryByText("Thinking...")).not.toBeInTheDocument()
  })

  it("shows provider-agnostic tool labels and error detail", () => {
    render(
      <ReasoningTrace
        message={{
          role: "assistant",
          content: "answer",
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
})
