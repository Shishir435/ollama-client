import { render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { RunDetails } from "@/features/chat/components/run-details"

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string, values?: Record<string, unknown>) =>
      values?.count ? `${values.count} tools` : (fallback ?? key)
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

    expect(screen.getByText("Run details")).toBeInTheDocument()
    expect(screen.getByText("2.0s")).toBeInTheDocument()
    expect(screen.getByText("500ms")).toBeInTheDocument()
    expect(screen.getByText("250ms")).toBeInTheDocument()
    expect(screen.getByText("40 t/s")).toBeInTheDocument()
    expect(screen.getByText("40")).toBeInTheDocument()
    expect(screen.getByText("20")).toBeInTheDocument()
    expect(screen.getByText("1")).toBeInTheDocument()
  })
})
