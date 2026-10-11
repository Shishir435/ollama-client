import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { NativeEmbeddingFields } from "../native-embedding-fields"

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))

describe("migration controls", () => {
  it.each([
    "bundled",
    "external"
  ] as const)("allows cancelling a running rebuild in %s mode", (mode) => {
    const command = vi.fn()
    render(
      <NativeEmbeddingFields
        native={{
          state: {
            id: "active",
            mode,
            migration: "building",
            current: 1,
            total: 10,
            lastId: 1,
            generation: 0
          },
          dismissed: false,
          busy: true,
          error: false,
          command
        }}
      />
    )
    const cancel = screen.getByRole("button", { name: "common.cancel" })
    expect(cancel).toBeEnabled()
    fireEvent.click(cancel)
    expect(command).toHaveBeenCalledWith("cancel")
  })
})
