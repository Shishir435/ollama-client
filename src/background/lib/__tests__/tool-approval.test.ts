import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const grantStore = vi.hoisted(() => new Map<string, unknown>())

vi.mock("@/lib/plasmo-global-storage", () => ({
  getPlasmoStoredValue: vi.fn(async (key: string) => grantStore.get(key)),
  setPlasmoStoredValue: vi.fn(async (key: string, value: unknown) => {
    grantStore.set(key, value)
  })
}))

import { STORAGE_KEYS } from "@/lib/constants"
import { hasAlwaysGrant } from "@/lib/tools/approval/approval-grants"
import {
  awaitToolConfirmation,
  clearPendingConfirmations,
  resolveToolConfirmation
} from "../tool-confirmation-registry"
import {
  addSessionGrant,
  clearSessionGrants,
  hasSessionGrant,
  resetSessionGrantCacheForTests
} from "../tool-session-grants"

describe("tool session grants", () => {
  beforeEach(() => clearSessionGrants())

  it("scopes grants to session + tool", async () => {
    await addSessionGrant("s1", "restore_session")

    expect(await hasSessionGrant("s1", "restore_session")).toBe(true)
    expect(await hasSessionGrant("s2", "restore_session")).toBe(false)
    expect(await hasSessionGrant("s1", "cancel_reminder")).toBe(false)
    expect(await hasSessionGrant(undefined, "restore_session")).toBe(false)
  })

  it("invalidates a session grant when untrusted input advances", async () => {
    await addSessionGrant("s1", "save_artifact", { taintGeneration: 0 })

    expect(
      await hasSessionGrant("s1", "save_artifact", { taintGeneration: 0 })
    ).toBe(true)
    expect(
      await hasSessionGrant("s1", "save_artifact", { taintGeneration: 1 })
    ).toBe(false)
  })

  it("clears one session's grants without touching others", async () => {
    await addSessionGrant("s1", "restore_session")
    await addSessionGrant("s2", "restore_session")

    await clearSessionGrants("s1")

    expect(await hasSessionGrant("s1", "restore_session")).toBe(false)
    expect(await hasSessionGrant("s2", "restore_session")).toBe(true)
  })
})

describe("a chat grant across a worker restart", () => {
  const area = new Map<string, unknown>()
  const storage = chrome.storage as unknown as { session?: unknown }
  beforeEach(() => {
    area.clear()
    storage.session = {
      get: vi.fn(async (key: string) =>
        area.has(key) ? { [key]: area.get(key) } : {}
      ),
      set: vi.fn(async (items: Record<string, unknown>) => {
        for (const [key, value] of Object.entries(items)) area.set(key, value)
      })
    }
    resetSessionGrantCacheForTests()
  })
  afterEach(() => {
    delete storage.session
    resetSessionGrantCacheForTests()
  })

  it("is still there when a fresh worker reads it back", async () => {
    await addSessionGrant("s1", "browser_task", { chat: true })
    resetSessionGrantCacheForTests()
    expect(await hasSessionGrant("s1", "browser_task", { chat: true })).toBe(
      true
    )
  })

  it("covers the chat on any site and after a page read, and nothing else", async () => {
    await addSessionGrant("s1", "browser_task", { chat: true })
    expect(await hasSessionGrant("s1", "browser_task", { chat: true })).toBe(
      true
    )
    expect(
      await hasSessionGrant("s1", "browser_task", {
        origin: "https://other.example",
        taintGeneration: 1
      })
    ).toBe(false)
    expect(await hasSessionGrant("s2", "browser_task", { chat: true })).toBe(
      false
    )
  })
})

describe("confirmation scopes", () => {
  beforeEach(async () => {
    await clearSessionGrants()
    clearPendingConfirmations()
    grantStore.clear()
  })

  it("applies a session grant when approved for the chat", async () => {
    const pending = awaitToolConfirmation("call1", {
      toolName: "restore_session",
      sessionId: "s1"
    })
    resolveToolConfirmation("call1", true, "session")

    await expect(pending).resolves.toBe(true)
    expect(await hasSessionGrant("s1", "restore_session")).toBe(true)
  })

  it("persists an always grant when approved always", async () => {
    const pending = awaitToolConfirmation("call2", {
      toolName: "cancel_reminder",
      sessionId: "s1"
    })
    resolveToolConfirmation("call2", true, "always")

    await expect(pending).resolves.toBe(true)
    await vi.waitFor(async () => {
      expect(await hasAlwaysGrant("cancel_reminder")).toBe(true)
    })
    expect(await hasSessionGrant("s1", "cancel_reminder")).toBe(false)
  })

  it("does not persist an always grant from a tainted turn", async () => {
    const pending = awaitToolConfirmation("tainted-always", {
      toolName: "save_artifact",
      sessionId: "s1",
      taintGeneration: 1
    })
    resolveToolConfirmation("tainted-always", true, "always")

    await expect(pending).resolves.toBe(true)
    expect(await hasAlwaysGrant("save_artifact")).toBe(false)
  })

  it("applies no grant on a plain once approval or a denial", async () => {
    const approve = awaitToolConfirmation("call3", {
      toolName: "restore_session",
      sessionId: "s1"
    })
    resolveToolConfirmation("call3", true, undefined)
    await expect(approve).resolves.toBe(true)

    const deny = awaitToolConfirmation("call4", {
      toolName: "restore_session",
      sessionId: "s1"
    })
    resolveToolConfirmation("call4", false, "always")
    await expect(deny).resolves.toBe(false)

    expect(await hasSessionGrant("s1", "restore_session")).toBe(false)
    expect(await hasAlwaysGrant("restore_session")).toBe(false)
    expect(grantStore.get(STORAGE_KEYS.TOOLS.APPROVAL_GRANTS) ?? {}).toEqual({})
  })

  it("denies when the signal aborts while waiting", async () => {
    const controller = new AbortController()
    const pending = awaitToolConfirmation(
      "call5",
      { toolName: "restore_session", sessionId: "s1" },
      controller.signal
    )
    controller.abort()

    await expect(pending).resolves.toBe(false)
    expect(await hasSessionGrant("s1", "restore_session")).toBe(false)
  })

  it("binds grants to the resolved origin for origin-scoped tools", async () => {
    const pending = awaitToolConfirmation("call-origin", {
      toolName: "capture_screenshot",
      sessionId: "s1",
      origin: "https://github.com",
      originScoped: true
    })
    resolveToolConfirmation("call-origin", true, "always")

    await expect(pending).resolves.toBe(true)
    await vi.waitFor(async () => {
      expect(
        await hasAlwaysGrant("capture_screenshot", "https://github.com")
      ).toBe(true)
    })
    // The origin-bound grant must not be reachable through the wildcard key.
    expect(await hasAlwaysGrant("capture_screenshot")).toBe(false)
    expect(
      await hasAlwaysGrant("capture_screenshot", "https://evil.example")
    ).toBe(false)
  })

  it("persists no grant when an origin-scoped call has no resolved origin", async () => {
    const session = awaitToolConfirmation("call-noorigin-1", {
      toolName: "capture_screenshot",
      sessionId: "s1",
      originScoped: true
    })
    resolveToolConfirmation("call-noorigin-1", true, "session")
    await expect(session).resolves.toBe(true)

    const always = awaitToolConfirmation("call-noorigin-2", {
      toolName: "capture_screenshot",
      sessionId: "s1",
      originScoped: true
    })
    resolveToolConfirmation("call-noorigin-2", true, "always")
    await expect(always).resolves.toBe(true)

    expect(await hasSessionGrant("s1", "capture_screenshot")).toBe(false)
    expect(await hasAlwaysGrant("capture_screenshot")).toBe(false)
    expect(grantStore.get(STORAGE_KEYS.TOOLS.APPROVAL_GRANTS) ?? {}).toEqual({})
  })

  it("consumes a decision that arrived before restart recovery registered", async () => {
    resolveToolConfirmation("recovered-call", true, "session")
    const pending = awaitToolConfirmation("recovered-call", {
      toolName: "restore_session",
      sessionId: "s1"
    })

    await expect(pending).resolves.toBe(true)
    expect(await hasSessionGrant("s1", "restore_session")).toBe(true)
  })
})
