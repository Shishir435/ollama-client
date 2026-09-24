import { afterEach, describe, expect, it, vi } from "vitest"

vi.mock("@/lib/browser-api", () => ({
  supportsSessions: vi.fn(() => true),
  supportsSyncedSessions: vi.fn(() => true),
  supportsTabGroups: vi.fn(() => true)
}))

import {
  type BrowserTaskRunner,
  browserTaskDefinition,
  runBrowserTask,
  setBrowserTaskRunner
} from "../browser-task-tool"
import { createInternalToolSource } from "../internal-tool-source"

const runner = (): BrowserTaskRunner => ({
  confirmation: vi.fn(async () => ({ always: true, summary: "goal" })),
  origin: vi.fn(async () => "https://example.com"),
  run: vi.fn(async () => ({ content: "done" }))
})

const offered = async () =>
  (await createInternalToolSource().listTools()).map((tool) => tool.name)

afterEach(() => setBrowserTaskRunner(undefined))

describe("browser_task", () => {
  /** Firefox compiles the agent out, so nothing installs a runner there. */
  it("is offered only where the agent installed a runner", async () => {
    expect(await offered()).not.toContain("browser_task")
    setBrowserTaskRunner(runner())
    expect(await offered()).toContain("browser_task")
  })

  it("hands the runner a trimmed goal and what the model said about it", async () => {
    const installed = runner()
    setBrowserTaskRunner(installed)

    await runBrowserTask(
      {
        goal: "  Find the pricing page  ",
        tab_id: 9,
        continue_previous_task: true
      },
      { sessionId: "chat-1" }
    )

    expect(installed.run).toHaveBeenCalledWith(
      { goal: "Find the pricing page", tabId: 9, continuePrevious: true },
      { sessionId: "chat-1" }
    )
  })

  it("refuses an empty goal without reaching the runner", async () => {
    const installed = runner()
    setBrowserTaskRunner(installed)

    const result = await runBrowserTask({ goal: "   " }, {})

    expect(result.isError).toBe(true)
    expect(installed.run).not.toHaveBeenCalled()
  })

  /**
   * Starting is asked about once per chat and site; the per-step approvals
   * are the run's own. The result is page-derived, and the call waits far
   * longer than the loop's usual minute.
   */
  it("prices its start as a medium-risk, origin-scoped, untrusted call", async () => {
    setBrowserTaskRunner(runner())

    expect(browserTaskDefinition.risk).toBe("medium")
    expect(browserTaskDefinition.resultProvenance).toBe("web-untrusted")
    expect(browserTaskDefinition.runtime?.parallelizable).toBe(false)
    expect(browserTaskDefinition.runtime?.timeoutMs).toBeGreaterThan(
      45 * 60_000
    )
    await expect(
      browserTaskDefinition.grantScopeResolver?.({ goal: "x" }, {})
    ).resolves.toBe("https://example.com")
    await expect(
      browserTaskDefinition.confirmation?.({ goal: "x" }, {})
    ).resolves.toEqual({ always: true, summary: "goal" })
  })
})
