import { render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import type { ModelCapabilities } from "@/lib/providers/capabilities"
import { ModelCapabilityBadges } from "../capability-badges"

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))

const caps = (over: Partial<ModelCapabilities>): ModelCapabilities => ({
  text: true,
  vision: false,
  imageOutput: false,
  embeddings: false,
  toolCalling: false,
  reasoning: false,
  source: "model-metadata",
  confidence: "high",
  ...over
})

describe("ModelCapabilityBadges", () => {
  it("renders a badge for each notable capability", () => {
    render(
      <ModelCapabilityBadges caps={caps({ vision: true, toolCalling: true })} />
    )

    expect(
      screen.getByText("model.capabilities.flags.vision.label")
    ).toBeInTheDocument()
    expect(
      screen.getByText("model.capabilities.flags.toolCalling.label")
    ).toBeInTheDocument()
  })

  it("names each badge with text, not an aria-label on a span", () => {
    render(<ModelCapabilityBadges caps={caps({ vision: true })} />)
    const label = screen.getByText("model.capabilities.flags.vision.label")
    expect(label).toHaveClass("sr-only")
    expect(label.closest("[aria-label]")).toBeNull()
  })

  it("renders a completion/text badge (mirrors Ollama's chips)", () => {
    render(<ModelCapabilityBadges caps={caps({ text: true })} />)
    expect(
      screen.getByText("model.capabilities.flags.text.label")
    ).toBeInTheDocument()
  })

  it("renders all four chat capabilities a model like qwen exposes", () => {
    render(
      <ModelCapabilityBadges
        caps={caps({
          text: true,
          vision: true,
          toolCalling: true,
          reasoning: true
        })}
      />
    )
    for (const flag of ["text", "vision", "toolCalling", "reasoning"]) {
      expect(
        screen.getByText(`model.capabilities.flags.${flag}.label`)
      ).toBeInTheDocument()
    }
  })

  it("renders nothing when the model has no known capability", () => {
    const { container } = render(
      <ModelCapabilityBadges caps={caps({ text: false })} />
    )
    expect(container).toBeEmptyDOMElement()
  })
})
