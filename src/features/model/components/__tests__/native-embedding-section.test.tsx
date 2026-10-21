import { fireEvent, render, screen } from "@testing-library/react"
import type { ReactNode } from "react"
import { describe, expect, it, vi } from "vitest"
import type { useNativeEmbeddings } from "../../hooks/use-native-embeddings"
import { NativeEmbeddingSection } from "../native-embedding-section"

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))

vi.mock("../native-embedding-fields", () => ({
  NativeEmbeddingFields: ({ children }: { children: ReactNode }) => (
    <>{children}</>
  )
}))

describe("NativeEmbeddingSection", () => {
  it("attaches the deep-link focus handler when its fieldset mounts later", () => {
    const baseNative = { state: null, busy: false } as unknown as ReturnType<
      typeof useNativeEmbeddings
    >
    const { rerender } = render(
      <NativeEmbeddingSection native={baseNative}>
        <div data-testid="external-provider-fields" />
      </NativeEmbeddingSection>
    )

    const loadedNative = {
      ...baseNative,
      state: { mode: "bundled", migration: "idle" }
    } as ReturnType<typeof useNativeEmbeddings>
    rerender(
      <NativeEmbeddingSection native={loadedNative}>
        <div data-testid="external-provider-fields" />
      </NativeEmbeddingSection>
    )

    fireEvent.focus(
      screen.getByLabelText("settings.embeddings.bundled.mode_title")
    )

    expect(
      screen.getByRole("radio", {
        name: "settings.embeddings.bundled.mode_external"
      })
    ).toBeChecked()
    expect(screen.getByTestId("external-provider-fields")).toBeInTheDocument()
  })
})
