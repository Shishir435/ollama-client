import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { PermissionsPanel } from "@/features/permissions/components/permissions-panel"
import { getScheduledJobSettings } from "@/lib/scheduled-jobs"
import { useFeatureFlagsStore } from "@/stores/feature-flags"

const perm = vi.hoisted(() => ({
  hasPermission: vi.fn(),
  requestPermission: vi.fn(),
  removePermission: vi.fn()
}))

vi.mock("@/lib/permissions", () => ({
  hasPermission: perm.hasPermission,
  requestPermission: perm.requestPermission,
  removePermission: perm.removePermission
}))

const browserApi = vi.hoisted(() => ({
  sendMessage: vi.fn(),
  createNotification: vi.fn(),
  supportsTabGroups: vi.fn()
}))

vi.mock("@/lib/browser-api", () => ({
  browser: {
    runtime: {
      sendMessage: browserApi.sendMessage,
      getURL: (path: string) => `chrome-extension://test/${path}`
    },
    notifications: {
      create: browserApi.createNotification
    }
  },
  supportsTabGroups: browserApi.supportsTabGroups
}))

vi.mock("@/lib/scheduled-jobs", () => ({
  getScheduledJobSettings: vi.fn().mockResolvedValue({
    enabled: { "vector-maintenance": false }
  }),
  setScheduledJobEnabled: vi.fn().mockResolvedValue({
    enabled: { "vector-maintenance": true }
  })
}))

vi.mock("@/features/model/hooks/use-provider-models", () => ({
  useProviderModels: () => ({
    models: [{ name: "qwen", providerId: "ollama" }]
  })
}))

const toolOverrides = vi.hoisted(() => ({
  store: {} as Record<string, unknown>,
  patchToolModelOverride: vi.fn(),
  clearToolModelOverride: vi.fn()
}))

vi.mock("@/lib/tools/tool-model-overrides", () => ({
  getAllToolModelOverrides: vi.fn(async () => toolOverrides.store),
  getEffectiveToolFamilySettings: vi.fn(async () => ({
    enabled: true,
    families: {
      browser: true,
      knowledge: true,
      history: true,
      web: true,
      automation: true
    }
  })),
  patchToolModelOverride: (...args: unknown[]) =>
    toolOverrides.patchToolModelOverride(...args),
  clearToolModelOverride: (...args: unknown[]) =>
    toolOverrides.clearToolModelOverride(...args),
  toolModelOverrideKey: (providerId: string, model: string) =>
    `${providerId}::${model}`
}))

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))

beforeEach(() => {
  vi.clearAllMocks()
  perm.hasPermission.mockResolvedValue(false)
  perm.requestPermission.mockResolvedValue(true)
  perm.removePermission.mockResolvedValue(true)
  browserApi.sendMessage.mockResolvedValue({ success: true })
  browserApi.createNotification.mockResolvedValue("test-notification")
  browserApi.supportsTabGroups.mockReturnValue(false)
  useFeatureFlagsStore.getState().reset()
})

describe("PermissionsPanel", () => {
  it("renders optional-permission and preview-flag switches", () => {
    render(<PermissionsPanel />)
    expect(document.getElementById("permission-bookmarks")).toBeTruthy()
    expect(document.getElementById("permission-history")).toBeTruthy()
    expect(document.getElementById("permission-alarms")).toBeTruthy()
    expect(
      document.getElementById("scheduled-job-vector-maintenance")
    ).toBeTruthy()
    expect(document.getElementById("feature-flag-omnibox")).toBeTruthy()
  })

  it("requests the alarms permission when its switch is enabled", () => {
    render(<PermissionsPanel />)
    fireEvent.click(document.getElementById("permission-alarms") as Element)
    expect(perm.requestPermission).toHaveBeenCalledWith("alarms")
  })

  it("renders the per-model tool override section in the full layout", async () => {
    render(<PermissionsPanel />)
    await waitFor(() =>
      expect(
        screen.getByText("settings.permissions.tools.perModel.title")
      ).toBeTruthy()
    )
  })

  it("omits the per-model tool override section in the compact layout", () => {
    render(<PermissionsPanel compact />)
    expect(
      screen.queryByText("settings.permissions.tools.perModel.title")
    ).toBeNull()
  })

  it("requests the API permission when its switch is enabled", () => {
    render(<PermissionsPanel />)
    fireEvent.click(document.getElementById("permission-bookmarks") as Element)
    expect(perm.requestPermission).toHaveBeenCalledWith("bookmarks")
  })

  it("shows the tab-groups optional permission when supported", async () => {
    browserApi.supportsTabGroups.mockReturnValue(true)
    render(<PermissionsPanel />)

    expect(document.getElementById("permission-tab-groups")).toBeTruthy()
    fireEvent.click(document.getElementById("permission-tab-groups") as Element)

    await waitFor(() =>
      expect(perm.requestPermission).toHaveBeenCalledWith("tabGroups")
    )
  })

  it("sends a test notification from the permissions card", async () => {
    browserApi.sendMessage.mockResolvedValue({
      success: true,
      data: { sent: true }
    })
    render(<PermissionsPanel />)
    fireEvent.click(
      screen.getByRole("button", {
        name: "settings.permissions.items.notifications.testButton"
      })
    )

    await waitFor(() =>
      expect(browserApi.sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "app-notify-job-complete"
        })
      )
    )
    await waitFor(() =>
      expect(
        screen.getByText("settings.permissions.items.notifications.testSent")
      ).toBeTruthy()
    )
  })

  it("shows permission denied feedback for the test notification", async () => {
    perm.hasPermission.mockResolvedValue(false)
    perm.requestPermission.mockResolvedValue(false)

    render(<PermissionsPanel />)
    fireEvent.click(
      screen.getByRole("button", {
        name: "settings.permissions.items.notifications.testButton"
      })
    )

    await waitFor(() =>
      expect(
        screen.getByText("settings.permissions.items.notifications.testDenied")
      ).toBeTruthy()
    )
  })

  it("refreshes the notifications switch after the test button grants permission", async () => {
    let notificationsGranted = false
    perm.hasPermission.mockImplementation(async (permission) =>
      permission === "notifications" ? notificationsGranted : false
    )
    perm.requestPermission.mockImplementation(async (permission) => {
      if (permission === "notifications") notificationsGranted = true
      return true
    })

    render(<PermissionsPanel />)
    await waitFor(() =>
      expect(
        screen.getByRole("switch", {
          name: "settings.permissions.items.notifications.label"
        })
      ).not.toBeChecked()
    )

    fireEvent.click(
      screen.getByRole("button", {
        name: "settings.permissions.items.notifications.testButton"
      })
    )

    await waitFor(() =>
      expect(
        screen.getByRole("switch", {
          name: "settings.permissions.items.notifications.label"
        })
      ).toBeChecked()
    )
  })

  it("shows skipped feedback when background gives no response", async () => {
    browserApi.sendMessage.mockResolvedValue(undefined)

    render(<PermissionsPanel />)
    fireEvent.click(
      screen.getByRole("button", {
        name: "settings.permissions.items.notifications.testButton"
      })
    )

    await waitFor(() =>
      expect(
        screen.getByText("settings.permissions.items.notifications.testSkipped")
      ).toBeTruthy()
    )
    expect(browserApi.createNotification).not.toHaveBeenCalled()
  })

  it("keeps the toggle granted when a revoke fails (no misleading signal)", async () => {
    perm.hasPermission.mockResolvedValue(true)
    perm.removePermission.mockResolvedValue(false) // revoke fails — still held
    render(<PermissionsPanel />)
    // First switch is the bookmarks optional-permission row.
    const sw = screen.getAllByRole("switch")[0]
    await waitFor(() => expect(sw).toBeChecked())
    fireEvent.click(sw)
    await waitFor(() =>
      expect(perm.removePermission).toHaveBeenCalledWith("bookmarks")
    )
    // Real state re-queried (still granted) → toggle stays on, not optimistic off.
    await waitFor(() => expect(sw).toBeChecked())
  })

  it("toggling a preview flag updates the feature-flags store", () => {
    render(<PermissionsPanel />)
    fireEvent.click(document.getElementById("feature-flag-omnibox") as Element)
    expect(useFeatureFlagsStore.getState().flags.omnibox).toBe(true)
  })

  it("compact mode omits the host-access note card", () => {
    const { queryByText } = render(<PermissionsPanel compact />)
    // host title key is only rendered in non-compact mode
    expect(queryByText("settings.permissions.host.title")).toBeNull()
  })

  it("hides the preview-features card in the production build", () => {
    const prev = process.env.NODE_ENV
    process.env.NODE_ENV = "production"
    try {
      render(<PermissionsPanel />)
      expect(document.getElementById("feature-flag-omnibox")).toBeNull()
    } finally {
      process.env.NODE_ENV = prev
    }
  })

  it("loads scheduled-job settings", async () => {
    render(<PermissionsPanel />)
    await waitFor(() => expect(getScheduledJobSettings).toHaveBeenCalled())
  })
})
