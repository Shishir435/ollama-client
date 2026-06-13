import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import type { ModelCapabilities } from "@/lib/providers/capabilities"
import { ModelCapabilitySheet } from "../capability-sheet"

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))

const allFalse: ModelCapabilities = {
  text: false,
  vision: false,
  embeddings: false,
  toolCalling: false,
  reasoning: false,
  source: "provider-default",
  confidence: "low"
}

const baseProps = {
  open: true,
  onOpenChange: vi.fn(),
  providerId: "vllm",
  modelName: "my-model",
  current: allFalse,
  detected: allFalse,
  canSelfReport: false,
  hasOverride: false
}

describe("ModelCapabilitySheet", () => {
  it("seeds toggles from the effective capabilities and saves a full override", () => {
    const onSave = vi.fn()
    // Effective state (e.g. detected vlm + saved override) has text + vision on.
    const effective = { ...allFalse, text: true, vision: true }
    render(
      <ModelCapabilitySheet
        {...baseProps}
        current={effective}
        detected={effective}
        onSave={onSave}
        onReset={vi.fn()}
      />
    )

    // Switches reflect the effective state: vision on.
    const switches = screen.getAllByRole("switch")
    expect(switches[1]).toBeChecked() // vision

    fireEvent.click(screen.getByText("model.capabilities.sheet.save"))

    // Save serializes the whole capability set as an explicit override.
    expect(onSave).toHaveBeenCalledWith({
      text: true,
      vision: true,
      toolCalling: false,
      reasoning: false,
      embeddings: false
    })
  })

  it("seeds toggles from a saved override, not bare detection", () => {
    // Detection sees only vision; the saved override also turned on tools.
    render(
      <ModelCapabilitySheet
        {...baseProps}
        current={{ ...allFalse, text: true, vision: true, toolCalling: true }}
        detected={{ ...allFalse, text: true, vision: true }}
        hasOverride={true}
        onSave={vi.fn()}
        onReset={vi.fn()}
      />
    )

    const switches = screen.getAllByRole("switch")
    expect(switches[1]).toBeChecked() // vision (detected)
    expect(switches[2]).toBeChecked() // tool calling (from override)
  })

  it("shows the manual-entry guidance when the provider cannot self-report", () => {
    render(
      <ModelCapabilitySheet {...baseProps} onSave={vi.fn()} onReset={vi.fn()} />
    )

    expect(
      screen.getByText("model.capabilities.sheet.note_manual")
    ).toBeInTheDocument()
  })

  it("disables reset when there is no override, and calls onReset otherwise", () => {
    const onReset = vi.fn()
    const { rerender } = render(
      <ModelCapabilitySheet
        {...baseProps}
        hasOverride={false}
        onSave={vi.fn()}
        onReset={onReset}
      />
    )

    const reset = screen.getByText("model.capabilities.sheet.reset")
    expect(reset).toBeDisabled()

    rerender(
      <ModelCapabilitySheet
        {...baseProps}
        hasOverride={true}
        onSave={vi.fn()}
        onReset={onReset}
      />
    )
    fireEvent.click(screen.getByText("model.capabilities.sheet.reset"))
    expect(onReset).toHaveBeenCalled()
  })
})
