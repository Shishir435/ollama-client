import type { ChildProcess } from "node:child_process"
import { EventEmitter } from "node:events"
import { describe, expect, it, vi } from "vitest"
import { foregroundSession } from "../foreground-process.js"

describe("owned foreground process", () => {
  it("forwards a signal only to its child and removes handlers after exit", async () => {
    const child = Object.assign(new EventEmitter(), { kill: vi.fn() })
    const before = process.listeners("SIGINT")
    const session = foregroundSession(child as unknown as ChildProcess)
    const interrupt = process
      .listeners("SIGINT")
      .find((listener) => !before.includes(listener))
    expect(interrupt).toBeDefined()
    interrupt?.("SIGINT")
    expect(child.kill).toHaveBeenCalledExactlyOnceWith("SIGINT")
    child.emit("exit", null, "SIGINT")
    expect(await session.finished).toBe(130)
    expect(process.listeners("SIGINT")).toEqual(before)
  })
  it("preserves runtime exit codes and supports startup cleanup", async () => {
    const child = Object.assign(new EventEmitter(), { kill: vi.fn() })
    const session = foregroundSession(child as unknown as ChildProcess)
    session.stop()
    expect(child.kill).toHaveBeenCalledWith("SIGTERM")
    child.emit("exit", 7, null)
    expect(await session.finished).toBe(7)
  })
  it("settles spawn failure without leaking a terminal handler", async () => {
    const child = Object.assign(new EventEmitter(), { kill: vi.fn() })
    const before = process.listeners("SIGTERM")
    const session = foregroundSession(child as unknown as ChildProcess)
    child.emit("error", new Error("ENOENT"))
    expect(await session.finished).toBe(1)
    expect(process.listeners("SIGTERM")).toEqual(before)
  })
})
