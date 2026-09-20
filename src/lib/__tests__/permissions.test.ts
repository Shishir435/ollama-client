import { beforeEach, describe, expect, it, vi } from "vitest"
import {
  hasAgentPerceptionPermission,
  hasPermission,
  removePermission,
  requestAgentPerceptionPermission,
  requestPermission,
  requestPermissions
} from "@/lib/permissions"

const contains = vi.fn()
const request = vi.fn()
const remove = vi.fn()

vi.mock("@/lib/browser-api", () => ({
  browser: {
    permissions: {
      contains: (...args: unknown[]) => contains(...args),
      request: (...args: unknown[]) => request(...args),
      remove: (...args: unknown[]) => remove(...args)
    }
  }
}))

beforeEach(() => {
  vi.clearAllMocks()
})

describe("permissions helper", () => {
  it("hasPermission queries the granted set with the permission name", async () => {
    contains.mockResolvedValue(true)
    await expect(hasPermission("bookmarks")).resolves.toBe(true)
    expect(contains).toHaveBeenCalledWith({ permissions: ["bookmarks"] })
  })

  it("requestPermission returns the grant result", async () => {
    request.mockResolvedValue(true)
    await expect(requestPermission("notifications")).resolves.toBe(true)
    expect(request).toHaveBeenCalledWith({ permissions: ["notifications"] })
  })

  it("requests related permissions in one user gesture", async () => {
    request.mockResolvedValue(true)
    await expect(requestPermissions(["alarms", "notifications"])).resolves.toBe(
      true
    )
    expect(request).toHaveBeenCalledWith({
      permissions: ["alarms", "notifications"]
    })
  })

  it("requests webNavigation only through the Agent user-gesture helper", async () => {
    contains.mockResolvedValue(true)
    request.mockResolvedValue(true)
    await expect(hasAgentPerceptionPermission()).resolves.toBe(true)
    await expect(requestAgentPerceptionPermission()).resolves.toBe(true)
    expect(contains).toHaveBeenCalledWith({ permissions: ["webNavigation"] })
    expect(request).toHaveBeenCalledWith({ permissions: ["webNavigation"] })
  })

  it("removePermission returns the removal result", async () => {
    remove.mockResolvedValue(true)
    await expect(removePermission("downloads")).resolves.toBe(true)
    expect(remove).toHaveBeenCalledWith({ permissions: ["downloads"] })
  })

  it("never throws — a rejected browser call resolves to false", async () => {
    contains.mockRejectedValue(new Error("denied"))
    request.mockRejectedValue(new Error("no user gesture"))
    remove.mockRejectedValue(new Error("nope"))

    await expect(hasPermission("history")).resolves.toBe(false)
    await expect(requestPermission("history")).resolves.toBe(false)
    await expect(removePermission("history")).resolves.toBe(false)
  })
})
