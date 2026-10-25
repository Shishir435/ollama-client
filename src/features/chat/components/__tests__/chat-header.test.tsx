import { act, render, screen } from "@testing-library/react"
import { expect, it, vi } from "vitest"
import { chatSessionStore } from "@/features/sessions/stores/chat-session-store"
import type { ChatMessage } from "@/types"

const mocks = vi.hoisted(() => ({ selector: vi.fn(), metrics: vi.fn() }))
vi.mock("@/features/chat/hooks/use-session-metrics-preference", () => ({
  useSessionMetricsPreference: () => [true]
}))
vi.mock("@/features/model/components/embedding-status-indicator", () => ({
  EmbeddingStatusIndicator: () => null
}))
vi.mock("@/features/model/components/provider-status-indicator", () => ({
  ProviderStatusIndicator: () => null
}))
vi.mock("@/features/sessions/components/chat-session-selector", () => ({
  ChatSessionSelector: () => {
    mocks.selector()
    return null
  }
}))
vi.mock("../session-metrics-bar", () => ({
  SessionMetricsBar: ({ messages }: { messages: ChatMessage[] }) => {
    mocks.metrics(messages)
    return <output>{messages[0]?.content}</output>
  }
}))

import { ChatHeader } from "../chat-header"

it("updates live metrics without rendering the session selector for each token", async () => {
  chatSessionStore.setState({
    sessions: [
      {
        id: "chat",
        title: "Chat",
        createdAt: 1,
        updatedAt: 1,
        messages: [
          { id: 1, role: "assistant", content: "before", timestamp: 1 }
        ]
      }
    ],
    currentSessionId: "chat",
    hasSession: true
  })
  const Shell = () => {
    const sessions = chatSessionStore((state) => state.sessions)
    return (
      <>
        <span>{sessions[0].messages?.length}</span>
        <ChatHeader />
      </>
    )
  }
  const { unmount } = render(<Shell />)
  expect(mocks.selector).toHaveBeenCalledOnce()
  await act(async () =>
    chatSessionStore.getState().updateMessage(1, { content: "streamed" }, true)
  )
  expect(screen.getByText("streamed")).toBeInTheDocument()
  expect(mocks.selector).toHaveBeenCalledOnce()
  expect(mocks.metrics).toHaveBeenCalledTimes(2)
  unmount()
})
