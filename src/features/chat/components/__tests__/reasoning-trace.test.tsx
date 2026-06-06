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

    expect(screen.getByText("Planning")).toBeInTheDocument()
    expect(screen.getByText("RAG")).toBeInTheDocument()
    expect(screen.getByText("Searching web")).toBeInTheDocument()
    expect(
      screen.queryByText("private reasoning detail")
    ).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole("button", { name: /Thought Process/i }))
    expect(screen.getByText("private reasoning detail")).toBeInTheDocument()
  })

  it("closes thinking details when clicking outside", async () => {
    render(<ReasoningTrace message={message} />)

    fireEvent.click(screen.getByRole("button", { name: /Thought Process/i }))
    expect(screen.getByText("private reasoning detail")).toBeInTheDocument()

    fireEvent.pointerDown(document.body)
    fireEvent.click(document.body)

    await waitFor(() =>
      expect(
        screen.queryByText("private reasoning detail")
      ).not.toBeInTheDocument()
    )
  })

  it("does not show web or file status when those actions did not happen", () => {
    render(
      <ReasoningTrace
        message={{
          role: "assistant",
          content: "answer",
          thinking: "short thought"
        }}
      />
    )

    expect(screen.getByText("Answering")).toBeInTheDocument()
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

  it("uses running labels for active steps", () => {
    render(
      <ReasoningTrace message={{ role: "assistant", content: "" }} isLoading />
    )

    expect(screen.getAllByText("Planning...").length).toBeGreaterThan(0)
    expect(screen.getAllByText("Answering...").length).toBeGreaterThan(0)
  })
})
