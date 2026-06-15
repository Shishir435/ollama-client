import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { AdvancedSection } from "../advanced-section"
import { SettingsFormField } from "../settings-form-field"
import { SettingsSliderField } from "../settings-slider-field"

describe("SettingsFormField focus id", () => {
  it("emits focus attributes when focusId is set", () => {
    const { container } = render(
      <SettingsFormField label="Temp" focusId="temperature">
        <input />
      </SettingsFormField>
    )
    const target = container.querySelector(
      '[data-settings-focus-id="temperature"]'
    )
    expect(target).not.toBeNull()
    expect(target?.getAttribute("data-settings-focus")).toBe("true")
  })

  it("omits focus attributes when focusId is absent", () => {
    const { container } = render(
      <SettingsFormField label="Temp">
        <input />
      </SettingsFormField>
    )
    expect(container.querySelector("[data-settings-focus]")).toBeNull()
    expect(container.querySelector("[data-settings-focus-id]")).toBeNull()
  })
})

describe("SettingsSliderField focus id", () => {
  it("forwards focusId to the wrapping field", () => {
    const { container } = render(
      <SettingsSliderField
        label="Chunk size"
        value={500}
        min={0}
        max={1000}
        focusId="chunk-size"
        onValueChange={() => {}}
      />
    )
    expect(
      container.querySelector('[data-settings-focus-id="chunk-size"]')
    ).not.toBeNull()
  })
})

describe("AdvancedSection", () => {
  it("is collapsed by default: shows summary, hides children", () => {
    render(
      <AdvancedSection title="Sampling" summary="temp 0.7, top_p 0.9">
        <div>hidden child</div>
      </AdvancedSection>
    )
    expect(screen.getByText("temp 0.7, top_p 0.9")).toBeInTheDocument()
    expect(screen.queryByText("hidden child")).toBeNull()
  })

  it("expands on toggle to reveal children", () => {
    render(
      <AdvancedSection title="Sampling" summary="summary text">
        <div>revealed child</div>
      </AdvancedSection>
    )
    fireEvent.click(screen.getByRole("button", { name: /sampling/i }))
    expect(screen.getByText("revealed child")).toBeInTheDocument()
    expect(screen.queryByText("summary text")).toBeNull()
  })

  it("respects defaultOpen", () => {
    render(
      <AdvancedSection title="Sampling" summary="s" defaultOpen>
        <div>open child</div>
      </AdvancedSection>
    )
    expect(screen.getByText("open child")).toBeInTheDocument()
  })

  it("never collapses destructive content and renders no toggle", () => {
    render(
      <AdvancedSection title="Danger" destructive summary="should not show">
        <div>destructive child</div>
      </AdvancedSection>
    )
    // children always visible
    expect(screen.getByText("destructive child")).toBeInTheDocument()
    // no collapse toggle
    expect(screen.queryByRole("button")).toBeNull()
    // summary never shown when expanded
    expect(screen.queryByText("should not show")).toBeNull()
  })
})
