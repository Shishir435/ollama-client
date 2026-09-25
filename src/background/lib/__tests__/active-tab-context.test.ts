import { afterEach, describe, expect, it, vi } from "vitest"

vi.mock("@/lib/browser-api", () => ({
  browser: { tabs: { get: vi.fn() } }
}))
vi.mock("@/lib/browser-tab-access", () => ({
  classifyTabAccess: vi.fn()
}))

import { browser } from "@/lib/browser-api"
import { classifyTabAccess } from "@/lib/browser-tab-access"
import { resolveActiveTabContext } from "../active-tab-context"

describe("resolveActiveTabContext", () => {
  afterEach(() => {
    vi.clearAllMocks()
  })

  it("returns nothing for a turn that carried no tab", async () => {
    expect(await resolveActiveTabContext(undefined)).toBeUndefined()
    expect(browser.tabs.get).not.toHaveBeenCalled()
  })

  it("returns the title and the address without its query or fragment", async () => {
    vi.mocked(browser.tabs.get).mockResolvedValue({
      id: 4,
      title: "PR #421",
      url: "https://git.test/o/r/pull/421?token=secret#diff"
    } as never)
    vi.mocked(classifyTabAccess).mockResolvedValue("ok")

    expect(await resolveActiveTabContext(4)).toEqual({
      title: "PR #421",
      url: "https://git.test/o/r/pull/421"
    })
  })

  it.each([
    "restricted",
    "excluded"
  ] as const)("returns nothing for a %s tab", async (access) => {
    vi.mocked(browser.tabs.get).mockResolvedValue({
      id: 4,
      title: "Bank",
      url: "https://bank.test/"
    } as never)
    vi.mocked(classifyTabAccess).mockResolvedValue(access)
    expect(await resolveActiveTabContext(4)).toBeUndefined()
  })

  it("returns nothing for an incognito tab", async () => {
    vi.mocked(browser.tabs.get).mockResolvedValue({
      id: 4,
      title: "Private",
      url: "https://a.test/",
      incognito: true
    } as never)
    vi.mocked(classifyTabAccess).mockResolvedValue("ok")
    expect(await resolveActiveTabContext(4)).toBeUndefined()
  })

  it("returns nothing when the tab is gone", async () => {
    vi.mocked(browser.tabs.get).mockRejectedValue(new Error("No tab"))
    expect(await resolveActiveTabContext(4)).toBeUndefined()
  })
})
