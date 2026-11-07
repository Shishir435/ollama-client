import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import type { ConnectionHealth } from "@/features/model/hooks/use-connection-health"
import { ConnectionHealthNotice } from "../connection-health-notice"

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))

const health = (overrides: Partial<ConnectionHealth>) =>
  ({
    providerTone: "neutral",
    providerLabel: "Can't confirm P serves m",
    retryProvider: null,
    catalogUnverified: false,
    embeddings: {},
    ...overrides
  }) as ConnectionHealth

describe("ConnectionHealthNotice (chat)", () => {
  it("says nothing for a neutral state with nothing to act on", () => {
    const { container } = render(
      <ConnectionHealthNotice view="chat" health={health({})} />
    )
    expect(container).toBeEmptyDOMElement()
  })

  it("offers the selected provider's retry when its catalog never answered", () => {
    const retryProvider = vi.fn()
    render(
      <ConnectionHealthNotice
        view="chat"
        health={health({ catalogUnverified: true, retryProvider })}
      />
    )
    expect(screen.getByText("Can't confirm P serves m")).toBeInTheDocument()
    fireEvent.click(
      screen.getByRole("button", { name: /common.actions.retry/ })
    )
    expect(retryProvider).toHaveBeenCalledTimes(1)
  })
})
