import type { ChildProcess } from "node:child_process"
import { EventEmitter } from "node:events"
import { afterEach, describe, expect, it, vi } from "vitest"
import { awaitProxyHandoff } from "../detached-proxy.js"

/** No server or runtime is launched by these IPC protocol tests. */
function childFixture() {
  return Object.assign(new EventEmitter(), {
    pid: 12345,
    connected: true,
    kill: vi.fn(),
    unref: vi.fn(),
    disconnect: vi.fn(),
    send: vi.fn((_message, callback) => callback?.(null))
  })
}
const request = {
  options: { BACKEND: "codex", API_KEY: "private-test-key" },
  fileOptions: {}
}
afterEach(() => vi.useRealTimers())

describe("detached proxy handshake", () => {
  it("sends configuration only after boot and relinquishes ownership only after acceptance", async () => {
    const child = childFixture()
    const promise = awaitProxyHandoff(
      child as unknown as ChildProcess,
      request,
      "/tmp/proxy.log"
    )
    expect(child.send).not.toHaveBeenCalled()
    child.emit("message", { type: "olc:boot" })
    expect(child.send).toHaveBeenCalledWith(
      { type: "olc:start", ...request },
      expect.any(Function)
    )
    child.emit("message", { type: "olc:ready", url: "http://127.0.0.1:8083" })
    expect(child.unref).not.toHaveBeenCalled()
    expect(child.send).toHaveBeenCalledWith(
      { type: "olc:detach" },
      expect.any(Function)
    )
    child.emit("message", { type: "olc:detached" })
    expect(await promise).toEqual({
      pid: 12345,
      url: "http://127.0.0.1:8083",
      logPath: "/tmp/proxy.log"
    })
    expect(child.unref).toHaveBeenCalledOnce()
    expect(child.kill).not.toHaveBeenCalled()
  })
  it.each([
    "exit",
    "disconnect",
    "error"
  ])("reports %s before readiness as failure", async (event) => {
    const child = childFixture()
    const promise = awaitProxyHandoff(
      child as unknown as ChildProcess,
      request,
      "/tmp/proxy.log"
    )
    child.emit(event, new Error("failure"))
    await expect(promise).rejects.toThrow("Logs: /tmp/proxy.log")
    expect(child.kill).toHaveBeenCalledExactlyOnceWith("SIGTERM")
    expect(child.unref).not.toHaveBeenCalled()
  })
  it("does not report a backend startup error as success or echo configuration", async () => {
    const child = childFixture()
    const promise = awaitProxyHandoff(
      child as unknown as ChildProcess,
      request,
      "/tmp/proxy.log"
    )
    child.emit("message", { type: "olc:error" })
    await expect(promise).rejects.toThrow(
      "Proxy startup failed. Logs: /tmp/proxy.log"
    )
    expect(child.kill).toHaveBeenCalledWith("SIGTERM")
  })
  it("bounds startup time, including a missing handoff acknowledgement", async () => {
    vi.useFakeTimers()
    const child = childFixture()
    const promise = awaitProxyHandoff(
      child as unknown as ChildProcess,
      request,
      "/tmp/proxy.log",
      100
    )
    const rejected = expect(promise).rejects.toThrow("timed out")
    child.emit("message", { type: "olc:ready", url: "http://127.0.0.1:8083" })
    await vi.advanceTimersByTimeAsync(101)
    await rejected
    expect(child.kill).toHaveBeenCalledExactlyOnceWith("SIGTERM")
  })
})
