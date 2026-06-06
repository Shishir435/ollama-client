import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { ReasoningTrace } from "@/features/chat/components/reasoning-trace"
import type { ChatMessage } from "@/types"

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (_key: string, fallback?: string) => fallback ?? _key
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
    ragSources: [{ id: 1, title: "Doc", content: "content", score: 0.9 }],
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
    expect(screen.getByText("Using files")).toBeInTheDocument()
    expect(screen.getByText("Searching web")).toBeInTheDocument()
    expect(
      screen.queryByText("private reasoning detail")
    ).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole("button", { name: /Reasoning details/i }))
    expect(screen.getByText("private reasoning detail")).toBeInTheDocument()
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
    expect(screen.queryByText("Using files")).not.toBeInTheDocument()
  })
})
