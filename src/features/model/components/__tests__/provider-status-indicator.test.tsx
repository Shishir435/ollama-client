import { render, screen } from "@testing-library/react"
import type React from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { ProviderStatusIndicator } from "../provider-status-indicator"

const refresh = vi.fn()

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))

vi.mock("@/components/actions", () => ({
  TooltipActionButton: ({
    icon,
    ariaLabel,
    onClick
  }: {
    icon?: React.ReactNode
    ariaLabel?: string
    onClick?: () => void
  }) => (
    <button type="button" aria-label={ariaLabel} onClick={onClick}>
      {icon}
    </button>
  )
}))

vi.mock("@/features/model/hooks/use-provider-models", () => ({
  useProviderModels: () => ({ status: "ready", refresh, error: null })
}))

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe("ProviderStatusIndicator", () => {
  it("does not poll providers on a timer of its own", () => {
    render(<ProviderStatusIndicator />)

    // The old 10-second interval forced a full refresh past the query cache,
    // hidden panel included. Freshness belongs to the catalog queries now.
    vi.advanceTimersByTime(120_000)

    expect(refresh).not.toHaveBeenCalled()
  })

  it("still refreshes when asked", () => {
    render(<ProviderStatusIndicator />)

    screen.getByRole("button", { name: "model.provider_status.ready" }).click()

    expect(refresh).toHaveBeenCalledOnce()
  })
})
