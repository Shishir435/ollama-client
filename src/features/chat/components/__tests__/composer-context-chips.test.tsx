import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { ComposerContextChips } from "@/features/chat/components/chat-input/composer-context-chips"

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (_key: string, fallback?: string) => fallback ?? _key
  })
}))

describe("ComposerContextChips", () => {
  it("renders compact context toggles and hides future web by default", () => {
    const onToggleRAG = vi.fn()
    const onToggleTabs = vi.fn()

    render(
      <ComposerContextChips
        useRAG
        tabAccess={false}
        onToggleRAG={onToggleRAG}
        onToggleTabs={onToggleTabs}
      />
    )

    fireEvent.click(screen.getByRole("button", { name: /Files/i }))
    fireEvent.click(screen.getByRole("button", { name: /Page/i }))

    expect(onToggleRAG).toHaveBeenCalled()
    expect(onToggleTabs).toHaveBeenCalled()
    expect(
      screen.queryByRole("button", { name: /Web/i })
    ).not.toBeInTheDocument()
  })
})
