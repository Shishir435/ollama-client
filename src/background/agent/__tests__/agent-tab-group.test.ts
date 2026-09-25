import { beforeEach, describe, expect, it, vi } from "vitest"

const { group, update, supportsTabGroups, hasPermission } = vi.hoisted(() => ({
  group: vi.fn(),
  update: vi.fn(),
  supportsTabGroups: vi.fn(() => true),
  hasPermission: vi.fn(async () => true)
}))

vi.mock("@/lib/browser-api", () => ({
  browser: {
    tabs: { group },
    tabGroups: { update },
    i18n: { getMessage: () => "Ollama Client" }
  },
  supportsTabGroups
}))
vi.mock("@/lib/permissions", () => ({ hasPermission }))

import { groupAgentTab, resetAgentTabGroups } from "../agent-tab-group"

describe("groupAgentTab", () => {
  beforeEach(() => {
    resetAgentTabGroups()
    vi.clearAllMocks()
    supportsTabGroups.mockReturnValue(true)
    hasPermission.mockResolvedValue(true)
    group.mockResolvedValue(50)
  })

  it("gathers a run's tabs into one labelled group, leaving the start tab out", async () => {
    await groupAgentTab(1, 10)
    await groupAgentTab(1, 11)
    await groupAgentTab(10, 12)

    expect(group.mock.calls).toEqual([
      [{ tabIds: 10 }],
      [{ tabIds: 11, groupId: 50 }],
      [{ tabIds: 12, groupId: 50 }]
    ])
    expect(update).toHaveBeenCalledOnce()
    expect(update).toHaveBeenCalledWith(50, {
      title: "Ollama Client",
      color: "purple"
    })
  })

  it("does nothing without the optional permission", async () => {
    hasPermission.mockResolvedValue(false)
    await groupAgentTab(1, 10)
    expect(group).not.toHaveBeenCalled()
  })

  it("starts a fresh group when the old one is gone", async () => {
    await groupAgentTab(1, 10)
    group.mockRejectedValueOnce(new Error("No group with id: 50"))
    await groupAgentTab(1, 11)
    group.mockResolvedValue(60)
    await groupAgentTab(1, 13)
    expect(group).toHaveBeenLastCalledWith({ tabIds: 13 })
  })
})
