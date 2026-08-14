import { beforeEach, describe, expect, it, vi } from "vitest"
import { supportsSessions, supportsTabGroups } from "@/lib/browser-api"
import { hasPermission } from "@/lib/permissions"
import { findOptionalPermissionNotice } from "../optional-permission-notice"

vi.mock("@/lib/browser-api", () => ({
  supportsSessions: vi.fn(() => true),
  supportsTabGroups: vi.fn(() => true)
}))

vi.mock("@/lib/permissions", () => ({
  hasPermission: vi.fn()
}))

describe("optional permission notice", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(hasPermission).mockResolvedValue(false)
    vi.mocked(supportsSessions).mockReturnValue(true)
    vi.mocked(supportsTabGroups).mockReturnValue(true)
  })

  it.each([
    ["bookmarks", "Search my bookmarks for TypeScript", "permission-bookmarks"],
    ["history", "Show my recent browsing history", "permission-history"],
    [
      "downloads",
      "Save this answer as a markdown file",
      "permission-downloads"
    ],
    ["tabGroups", "Summarize my tab group", "permission-tab-groups"],
    ["sessions", "Show my recently closed tabs", "permission-sessions"],
    ["reminders", "Remind me in ten minutes", "permission-alarms"]
  ] as const)("finds disabled %s access", async (capabilityId, text, focusId) => {
    await expect(findOptionalPermissionNotice(text)).resolves.toMatchObject({
      capabilityId,
      focusId
    })
  })

  it("focuses Notifications when Alarms is already granted", async () => {
    vi.mocked(hasPermission).mockImplementation(
      async (permission) => permission === "alarms"
    )

    await expect(
      findOptionalPermissionNotice("Notify me when this is due")
    ).resolves.toMatchObject({
      capabilityId: "reminders",
      focusId: "permission-notifications",
      missingPermissions: ["notifications"]
    })
  })

  it("does not interrupt unrelated, granted, or unsupported access", async () => {
    await expect(
      findOptionalPermissionNotice("Explain the history of Rome")
    ).resolves.toBeUndefined()

    vi.mocked(hasPermission).mockResolvedValue(true)
    await expect(
      findOptionalPermissionNotice("Search my bookmarks")
    ).resolves.toBeUndefined()

    vi.mocked(hasPermission).mockResolvedValue(false)
    vi.mocked(supportsTabGroups).mockReturnValue(false)
    await expect(
      findOptionalPermissionNotice("Summarize my tab group")
    ).resolves.toBeUndefined()
  })
})
