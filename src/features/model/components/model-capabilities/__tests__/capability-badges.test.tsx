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
      screen.getByLabelText("model.capabilities.flags.vision.label")
    ).toBeInTheDocument()
    expect(
      screen.getByLabelText("model.capabilities.flags.toolCalling.label")
    ).toBeInTheDocument()
  })

  it("renders a completion/text badge (mirrors Ollama's chips)", () => {
    render(<ModelCapabilityBadges caps={caps({ text: true })} />)
    expect(
      screen.getByLabelText("model.capabilities.flags.text.label")
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
        screen.getByLabelText(`model.capabilities.flags.${flag}.label`)
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
