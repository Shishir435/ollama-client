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

  it("gathers a run's tabs into one labelled group", async () => {
    await groupAgentTab("run-1", 10)
    await groupAgentTab("run-1", 11)

    expect(group.mock.calls).toEqual([
      [{ tabIds: 10 }],
      [{ tabIds: 11, groupId: 50 }]
    ])
    expect(update).toHaveBeenCalledOnce()
    expect(update).toHaveBeenCalledWith(50, {
      title: "Ollama Client",
      color: "purple"
    })
  })

  /** Two tabs opened together both read "no group yet" without the chain. */
  it("makes one group for tabs a run opens at the same moment", async () => {
    await Promise.all([groupAgentTab("run-1", 10), groupAgentTab("run-1", 11)])
    expect(update).toHaveBeenCalledOnce()
    expect(group).toHaveBeenLastCalledWith({ tabIds: 11, groupId: 50 })
  })

  it("gives a later run from the same tab a group of its own", async () => {
    await groupAgentTab("run-1", 10)
    group.mockResolvedValue(60)
    await groupAgentTab("run-2", 20)
    expect(group).toHaveBeenLastCalledWith({ tabIds: 20 })
    expect(update).toHaveBeenCalledTimes(2)
  })

  it("does nothing without the optional permission", async () => {
    hasPermission.mockResolvedValue(false)
    await groupAgentTab("run-1", 10)
    expect(group).not.toHaveBeenCalled()
  })

  it("settles when the permission query itself fails", async () => {
    hasPermission.mockRejectedValue(new Error("unavailable"))
    await expect(groupAgentTab("run-1", 10)).resolves.toBeUndefined()
    expect(group).not.toHaveBeenCalled()
  })

  it("starts a fresh group when the run's group is gone", async () => {
    await groupAgentTab("run-1", 10)
    group.mockRejectedValueOnce(new Error("No group with id: 50"))
    group.mockResolvedValueOnce(60)
    await groupAgentTab("run-1", 11)
    expect(group).toHaveBeenLastCalledWith({ tabIds: 11 })
  })
})
