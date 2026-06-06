import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { RunDetails } from "@/features/chat/components/run-details"

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) =>
      ({
        "chat.metrics.total_time": "Total Time",
        "chat.metrics.load_time": "Load Time",
        "chat.metrics.prompt_eval_time": "Prompt Eval Time",
        "chat.metrics.generation_speed": "Generation Speed",
        "chat.metrics.generated_tokens": "Generated Tokens",
        "chat.metrics.prompt_tokens": "Prompt Tokens"
      })[key] ?? key
  })
}))

describe("RunDetails", () => {
  it("renders compact Ollama metrics with all six stats", () => {
    render(
      <RunDetails
        metrics={{
          total_duration: 2_000_000_000,
          load_duration: 500_000_000,
          prompt_eval_duration: 250_000_000,
          eval_count: 40,
          eval_duration: 1_000_000_000,
          prompt_eval_count: 20,
          toolRuns: [
            { toolId: "web-search", label: "Web", status: "done", startedAt: 1 }
          ]
        }}
      />
    )

    expect(screen.getByText("40 t/s")).toBeInTheDocument()
    expect(
      screen.getByText(
        "Total Time: 2.0s, Load Time: 500ms, Prompt Eval Time: 250ms, Generation Speed: 40 t/s, Generated Tokens: 40, Prompt Tokens: 20"
      )
    ).toBeInTheDocument()

    fireEvent.click(screen.getByRole("button"))
    expect(screen.getByText("Total Time")).toBeInTheDocument()
    expect(screen.getByText("Load Time")).toBeInTheDocument()
    expect(screen.getByText("Prompt Eval Time")).toBeInTheDocument()
    expect(screen.getAllByText("Generation Speed").length).toBeGreaterThan(1)
    expect(screen.getByText("Generated Tokens")).toBeInTheDocument()
    expect(screen.getByText("Prompt Tokens")).toBeInTheDocument()
  })
})
