import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { SessionMetricsBar } from "@/features/chat/components/session-metrics-bar"
import type { ChatMessage } from "@/types"

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) =>
      ({
        "chat.metrics.speed_unit": "t/s",
        "chat.session_metrics.label_tokens": "Tokens",
        "chat.session_metrics.label_time": "Time",
        "chat.session_metrics.label_speed": "Speed",
        "chat.session_metrics.label_responses": "Responses",
        "chat.session_metrics.tooltip_tokens": "Total tokens",
        "chat.session_metrics.tooltip_time": "Total time",
        "chat.session_metrics.tooltip_speed": "Average speed",
        "chat.session_metrics.tooltip_messages": "AI responses",
        "settings.chat_display.session_metrics_label": "Session Metrics"
      })[key] ?? key
  })
}))

const messages: ChatMessage[] = [
  { role: "user", content: "hello" },
  {
    role: "assistant",
    content: "hi",
    done: true,
    metrics: {
      total_duration: 2_000_000_000,
      eval_count: 40,
      eval_duration: 1_000_000_000,
      prompt_eval_count: 20
    }
  }
]

describe("SessionMetricsBar", () => {
  it("renders compact header trigger and shows all session stats in popover", () => {
    render(<SessionMetricsBar messages={messages} />)

    const trigger = screen.getByRole("button", { name: "Session Metrics" })
    expect(trigger).toHaveTextContent("40.0 t/s")

    fireEvent.click(trigger)

    expect(screen.getByText("Tokens")).toBeInTheDocument()
    expect(screen.getByText("Time")).toBeInTheDocument()
    expect(screen.getByText("Speed")).toBeInTheDocument()
    expect(screen.getByText("Responses")).toBeInTheDocument()
    expect(screen.getByText("60")).toBeInTheDocument()
    expect(screen.getByText("2.0s")).toBeInTheDocument()
    expect(screen.getByText("1")).toBeInTheDocument()
  })
})
