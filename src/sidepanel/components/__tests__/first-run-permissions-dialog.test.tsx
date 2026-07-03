import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { FirstRunPermissionsDialog } from "../first-run-permissions-dialog"

const store = vi.hoisted(() => ({ get: vi.fn(), set: vi.fn() }))
vi.mock("@/lib/plasmo-global-storage", () => ({
  plasmoGlobalStorage: { get: store.get, set: store.set }
}))

const api = vi.hoisted(() => ({
  openOptionsInTab: vi.fn(),
  getURL: vi.fn((path: string) => `chrome-extension://test/${path}`)
}))
vi.mock("@/lib/browser-api", () => ({
  openOptionsInTab: api.openOptionsInTab,
  runtime: { getURL: api.getURL }
}))

const providers = vi.hoisted(() => ({
  getProviderConfig: vi.fn(),
  updateProviderConfig: vi.fn()
}))
vi.mock("@/lib/providers/manager", () => ({
  ProviderManager: providers
}))

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))

beforeEach(() => {
  vi.clearAllMocks()
  store.set.mockResolvedValue(undefined)
  providers.getProviderConfig.mockResolvedValue({
    id: "ollama",
    type: "ollama",
    enabled: true,
    name: "Ollama",
    baseUrl: "http://localhost:11434"
  })
  providers.updateProviderConfig.mockResolvedValue(undefined)
})

describe("FirstRunPermissionsDialog", () => {
  it("shows on first run and deep-links to the Permissions tab", async () => {
    store.get.mockResolvedValue(undefined)
    render(<FirstRunPermissionsDialog />)

    await waitFor(() =>
      expect(screen.getByText("onboarding.permissions.title")).toBeTruthy()
    )

    fireEvent.click(screen.getByText("onboarding.continue"))
    fireEvent.click(screen.getByText("onboarding.provider.skip"))
    fireEvent.click(screen.getByText("onboarding.permissions.open"))

    expect(store.set).toHaveBeenCalledWith("onboarding-permissions-seen", true)
    expect(api.openOptionsInTab).toHaveBeenCalledWith(
      "chrome-extension://test/options.html?tab=privacy"
    )
  })

  it("stays hidden once the flag is set", async () => {
    store.get.mockResolvedValue(true)
    render(<FirstRunPermissionsDialog />)

    await waitFor(() => expect(store.get).toHaveBeenCalled())
    expect(screen.queryByText("onboarding.permissions.title")).toBeNull()
  })

  it("marks the intro seen when dismissed", async () => {
    store.get.mockResolvedValue(undefined)
    render(<FirstRunPermissionsDialog />)

    await waitFor(() =>
      expect(screen.getByText("onboarding.permissions.dismiss")).toBeTruthy()
    )

    fireEvent.click(screen.getByText("onboarding.permissions.dismiss"))

    expect(store.set).toHaveBeenCalledWith("onboarding-permissions-seen", true)
    expect(api.openOptionsInTab).not.toHaveBeenCalled()
  })
})
