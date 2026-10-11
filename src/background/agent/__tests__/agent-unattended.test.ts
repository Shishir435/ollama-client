import { afterEach, describe, expect, it, vi } from "vitest"
import type { AgentRunService } from "../agent-run-service"
import {
  agentBrowserSessionId,
  registerAgentUnattendedControls
} from "../agent-unattended"

const api = vi.hoisted(() => {
  const commands = new Set<(name: string) => void>()
  const menus = new Set<(info: { menuItemId: string | number }) => void>()
  return {
    commands,
    menus,
    stored: {} as Record<string, unknown>,
    platform: vi.fn(async () => undefined)
  }
})
vi.mock("@/lib/browser-api", () => ({
  browser: {
    storage: {
      session: {
        get: async () => api.stored,
        set: async (value: Record<string, unknown>) => {
          Object.assign(api.stored, value)
        }
      }
    },
    runtime: { getPlatformInfo: api.platform },
    commands: {
      onCommand: {
        addListener: (listener: (name: string) => void) =>
          api.commands.add(listener),
        removeListener: (listener: (name: string) => void) =>
          api.commands.delete(listener)
      }
    },
    contextMenus: {
      remove: async () => undefined,
      create: vi.fn(),
      onClicked: {
        addListener: (
          listener: (info: { menuItemId: string | number }) => void
        ) => api.menus.add(listener),
        removeListener: (
          listener: (info: { menuItemId: string | number }) => void
        ) => api.menus.delete(listener)
      }
    }
  }
}))
afterEach(() => {
  vi.useRealTimers()
  api.platform.mockClear()
})

describe("unattended browser controls", () => {
  it("keeps the nonce over worker recreation, without exposing it to a page", async () => {
    const first = await agentBrowserSessionId()
    expect(first).toBe(api.stored["agent-unattended-browser-session"])
    expect(await agentBrowserSessionId()).toBe(first)
    /** A worker restart keeps session storage, and with it the nonce. */
    vi.resetModules()
    const restarted = await import("../agent-unattended")
    expect(await restarted.agentBrowserSessionId()).toBe(first)
    /** A browser restart clears session storage, which mints a new one. */
    api.stored = {}
    vi.resetModules()
    const relaunched = await import("../agent-unattended")
    const next = await relaunched.agentBrowserSessionId()
    expect(next).not.toBe(first)
    expect(next).toBe(api.stored["agent-unattended-browser-session"])
  })

  it("stops through the keyboard or page menu with no panel, and sleeps at human boundaries", async () => {
    vi.useFakeTimers()
    let listener: (id: string) => void = () => undefined
    let status = "deciding"
    const stop = vi.fn(async () => undefined)
    const service = {
      latestRunId: async () => "run-1",
      stop,
      subscribe: (next: typeof listener) => {
        listener = next
        return () => {
          listener = () => undefined
        }
      },
      snapshot: async () => ({ run: { unattended: {}, status } })
    } as unknown as AgentRunService
    const dispose = registerAgentUnattendedControls(service, Promise.resolve())
    for (const command of api.commands) command("stop-agent")
    for (const menu of api.menus) menu({ menuItemId: "stop-browser-agent" })
    await vi.advanceTimersByTimeAsync(0)
    expect(stop).toHaveBeenCalledTimes(2)
    expect(stop).toHaveBeenCalledWith("run-1")
    listener("run-1")
    await vi.advanceTimersByTimeAsync(20_000)
    expect(api.platform).toHaveBeenCalledOnce()
    for (const next of [
      "awaiting_approval",
      "awaiting_takeover",
      "paused",
      "cancelled"
    ]) {
      status = next
      listener("run-1")
      await vi.advanceTimersByTimeAsync(20_000)
    }
    expect(api.platform).toHaveBeenCalledOnce()
    dispose()
    expect(api.commands.size).toBe(0)
    expect(api.menus.size).toBe(0)
  })
})
