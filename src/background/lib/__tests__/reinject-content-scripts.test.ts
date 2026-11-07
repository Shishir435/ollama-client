import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/lib/browser-api", () => ({
  browser: {
    tabs: { query: vi.fn() },
    scripting: { executeScript: vi.fn() }
  }
}))
vi.mock("@/lib/browser-tab-access", () => ({
  classifyTabAccess: vi.fn()
}))

import { browser } from "@/lib/browser-api"
import { classifyTabAccess } from "@/lib/browser-tab-access"
import { reinjectSelectionLoader } from "../reinject-content-scripts"

const query = vi.mocked(browser.tabs.query)
const executeScript = vi.mocked(browser.scripting.executeScript)
const classify = vi.mocked(classifyTabAccess)

describe("reinjectSelectionLoader", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    classify.mockResolvedValue("ok")
    executeScript.mockResolvedValue([] as never)
  })

  it("injects the loader into every frame of readable tabs", async () => {
    query.mockResolvedValue([
      { id: 1, url: "https://a.test" },
      { id: 2, url: "https://b.test" }
    ] as never)

    await reinjectSelectionLoader()

    expect(executeScript).toHaveBeenCalledWith({
      target: { tabId: 1, allFrames: true },
      files: ["content-scripts/selection-button.js"]
    })
    expect(executeScript).toHaveBeenCalledTimes(2)
  })

  it("skips excluded tabs and survives a tab that refuses injection", async () => {
    query.mockResolvedValue([
      { id: 1, url: "https://a.test" },
      { id: 2, url: "https://excluded.test" },
      { id: 3, url: "https://c.test" }
    ] as never)
    classify.mockImplementation(async (url) =>
      url === "https://excluded.test" ? "excluded" : "ok"
    )
    executeScript.mockRejectedValueOnce(new Error("Cannot access"))

    await expect(reinjectSelectionLoader()).resolves.toBeUndefined()

    expect(executeScript).toHaveBeenCalledTimes(2)
  })
})
