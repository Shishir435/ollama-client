import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { OptionalPermissionNoticeCard } from "../optional-permission-notice-card"

const browserMocks = vi.hoisted(() => ({
  openOptionsInTab: vi.fn(),
  getUrl: vi.fn((path: string) => `chrome-extension://test/${path}`)
}))

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, values?: { feature?: string }) =>
      values?.feature ? `${key}:${values.feature}` : key
  })
}))

vi.mock("@/lib/browser-api", () => ({
  openOptionsInTab: browserMocks.openOptionsInTab,
  runtime: { getURL: browserMocks.getUrl }
}))

const notice = {
  capabilityId: "bookmarks" as const,
  focusId: "permission-bookmarks",
  labelKey: "settings.permissions.items.bookmarks.label",
  missingPermissions: ["bookmarks" as const]
}

describe("OptionalPermissionNoticeCard", () => {
  it("enables access from the inline recovery action", async () => {
    const onEnable = vi.fn().mockResolvedValue("started")
    render(<OptionalPermissionNoticeCard notice={notice} onEnable={onEnable} />)

    fireEvent.click(
      screen.getByRole("button", {
        name: /chat.permissions.enable/
      })
    )

    await waitFor(() => expect(onEnable).toHaveBeenCalledOnce())
  })

  it("keeps a denial visible and links to the focused setting", async () => {
    render(
      <OptionalPermissionNoticeCard
        notice={notice}
        onEnable={vi.fn().mockResolvedValue("permission-denied")}
      />
    )

    fireEvent.click(
      screen.getByRole("button", { name: /chat.permissions.enable/ })
    )
    expect(
      await screen.findByText("chat.permissions.not_granted")
    ).toBeInTheDocument()

    fireEvent.click(
      screen.getByRole("button", { name: "chat.permissions.manage" })
    )
    expect(browserMocks.openOptionsInTab).toHaveBeenCalledWith(
      "chrome-extension://test/options.html?tab=privacy&focus=permission-bookmarks"
    )
  })

  it("distinguishes a failed resume from denied permission", async () => {
    render(
      <OptionalPermissionNoticeCard
        notice={notice}
        onEnable={vi.fn().mockResolvedValue("resume-failed")}
      />
    )

    fireEvent.click(
      screen.getByRole("button", { name: /chat.permissions.enable/ })
    )

    expect(
      await screen.findByText("chat.permissions.resume_failed")
    ).toBeInTheDocument()
  })
})
