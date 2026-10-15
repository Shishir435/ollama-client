import { MODEL_DISCOVERY_FAILURE } from "@ollama-client/contracts/provider-rpc"
import { render, screen } from "@testing-library/react"
import type React from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { ProviderStatusIndicator } from "../provider-status-indicator"

const refresh = vi.fn()
const state = vi.hoisted(() => ({
  failures: [] as { providerId: string; providerName: string; code: string }[]
}))

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))

vi.mock("@/components/actions", () => ({
  TooltipActionButton: ({
    icon,
    ariaLabel,
    onClick,
    tooltip
  }: {
    icon?: React.ReactNode
    ariaLabel?: string
    onClick?: () => void
    tooltip?: React.ReactNode
  }) => (
    <button type="button" aria-label={ariaLabel} onClick={onClick}>
      {icon}
      {tooltip}
    </button>
  )
}))

vi.mock("@/features/model/hooks/use-provider-models", () => ({
  useProviderModels: () => ({
    status: "ready",
    refresh,
    error: null,
    unavailableProviders: state.failures
  })
}))

beforeEach(() => {
  state.failures = []
  vi.clearAllMocks()
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe("ProviderStatusIndicator", () => {
  it("shows add-model guidance for a provider without a catalog", () => {
    state.failures = [
      {
        providerId: "custom:test",
        providerName: "Router",
        code: MODEL_DISCOVERY_FAILURE.MODEL_LIST_UNSUPPORTED
      }
    ]
    render(<ProviderStatusIndicator />)
    expect(
      screen.getByText("model.menu.providers_unavailable")
    ).toBeInTheDocument()
    expect(
      screen.queryByText("model.menu.providers_unreachable")
    ).not.toBeInTheDocument()
  })

  it("shows connection guidance when discovery fails", () => {
    state.failures = [
      {
        providerId: "custom:test",
        providerName: "Router",
        code: MODEL_DISCOVERY_FAILURE.REQUEST_FAILED
      }
    ]
    render(<ProviderStatusIndicator />)
    expect(
      screen.getByText("model.menu.providers_unreachable")
    ).toBeInTheDocument()
  })

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
