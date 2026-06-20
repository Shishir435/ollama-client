import { fireEvent, render } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { PermissionsPanel } from "@/features/permissions/components/permissions-panel"
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

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))

beforeEach(() => {
  vi.clearAllMocks()
  perm.hasPermission.mockResolvedValue(false)
  perm.requestPermission.mockResolvedValue(true)
  perm.removePermission.mockResolvedValue(true)
  useFeatureFlagsStore.getState().reset()
})

describe("PermissionsPanel", () => {
  it("renders optional-permission and preview-flag switches", () => {
    render(<PermissionsPanel />)
    expect(document.getElementById("permission-bookmarks")).toBeTruthy()
    expect(document.getElementById("permission-history")).toBeTruthy()
    expect(
      document.getElementById("feature-flag-screenshotVision")
    ).toBeTruthy()
  })

  it("requests the API permission when its switch is enabled", () => {
    render(<PermissionsPanel />)
    fireEvent.click(document.getElementById("permission-bookmarks") as Element)
    expect(perm.requestPermission).toHaveBeenCalledWith("bookmarks")
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
})
