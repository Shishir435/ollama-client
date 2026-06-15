import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { SettingsChangePreview } from "../settings-change-preview"

describe("SettingsChangePreview", () => {
  it("humanizes field and scalar-key labels and formats values", () => {
    render(
      <SettingsChangePreview
        writes={[
          {
            storageKey: "embeddings-config",
            field: "defaultSearchLimit",
            value: 10
          },
          {
            storageKey: "embeddings-config",
            field: "useReranking",
            value: true
          },
          { storageKey: "chat-max-tab-context-chars", value: 12000 },
          { storageKey: "chat-grounded-only-mode", value: false }
        ]}
      />
    )

    // camelCase field → sentence case
    expect(screen.getByText("Default search limit")).toBeInTheDocument()
    expect(screen.getByText("Use reranking")).toBeInTheDocument()
    // scalar key with store prefix stripped
    expect(screen.getByText("Max tab context chars")).toBeInTheDocument()
    expect(screen.getByText("Grounded only mode")).toBeInTheDocument()
    // values: number verbatim, boolean as On/Off
    expect(screen.getByText("10")).toBeInTheDocument()
    expect(screen.getByText("12000")).toBeInTheDocument()
    expect(screen.getByText("On")).toBeInTheDocument()
    expect(screen.getByText("Off")).toBeInTheDocument()
  })
})
