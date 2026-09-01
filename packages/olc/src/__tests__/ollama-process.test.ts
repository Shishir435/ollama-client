// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  execute: vi.fn(),
  readFile: vi.fn(),
  writeFile: vi.fn(),
  mkdir: vi.fn(),
  spawn: vi.fn(),
  delay: vi.fn()
}))
vi.mock("node:child_process", () => ({
  execFile: Object.assign(() => {}, {
    [Symbol.for("nodejs.util.promisify.custom")]: mocks.execute
  }),
  spawn: mocks.spawn
}))
vi.mock("node:fs/promises", () => ({
  default: {
    readFile: mocks.readFile,
    writeFile: mocks.writeFile,
    mkdir: mocks.mkdir,
    access: vi.fn().mockRejectedValue(new Error("not installed"))
  }
}))
vi.mock("node:timers/promises", () => ({ setTimeout: mocks.delay }))

import { resolveOllamaOptions } from "../ollama/config.js"
import {
  applyManager,
  detectManager,
  managerEnvironment
} from "../ollama/manager.js"
import {
  listeners,
  ollamaEnvironment,
  processIdentity,
  stopListener
} from "../ollama/process.js"

const identity = "1000 Mon Sep  1 12:34:56 2026 /usr/local/bin/ollama"
const listener = {
  pid: 1234,
  identity,
  host: "127.0.0.1",
  executable: "/usr/local/bin/ollama",
  uid: 1000
}

beforeEach(() => {
  mocks.execute.mockReset().mockResolvedValue({ stdout: "" })
  mocks.readFile.mockReset()
  mocks.writeFile.mockReset()
  mocks.mkdir.mockReset()
  mocks.spawn.mockReset()
  mocks.delay.mockReset().mockResolvedValue(undefined)
})
const originalPlatform = process.platform
afterEach(() => {
  Object.defineProperty(process, "platform", { value: originalPlatform })
  vi.restoreAllMocks()
})

describe("process identity and shutdown", () => {
  it("reads a listener's actual bind, executable, owner, and birth time", async () => {
    Object.defineProperty(process, "platform", { value: "darwin" })
    mocks.execute
      .mockResolvedValueOnce({ stdout: "p1234\nn*:11434\n" })
      .mockResolvedValueOnce({ stdout: identity })
    expect(await listeners(11434)).toEqual([{ ...listener, host: "0.0.0.0" }])
    expect(mocks.execute).toHaveBeenCalledWith(
      "lsof",
      ["-nP", "-iTCP:11434", "-sTCP:LISTEN", "-Fpn"],
      expect.any(Object)
    )
  })
  it("distinguishes an empty port from a missing inspection tool", async () => {
    Object.defineProperty(process, "platform", { value: "linux" })
    mocks.execute.mockRejectedValueOnce({ code: 1, stdout: "", stderr: "" })
    expect(await listeners(11434)).toEqual([])
    mocks.execute.mockRejectedValueOnce({ code: "ENOENT" })
    await expect(listeners(11434)).rejects.toThrow("Install lsof")
  })
  it("refuses to signal a recycled PID", async () => {
    const kill = vi.spyOn(process, "kill").mockReturnValue(true)
    mocks.execute.mockResolvedValue({
      stdout: identity.replace("12:34:56", "12:35:00")
    })
    await expect(stopListener(listener)).rejects.toThrow(
      "identity or owner changed"
    )
    expect(kill).not.toHaveBeenCalled()
  })
  it("refuses to signal another user's Ollama", async () => {
    const kill = vi.spyOn(process, "kill").mockReturnValue(true)
    mocks.execute.mockResolvedValue({ stdout: identity })
    vi.spyOn(process, "getuid").mockReturnValue(2000)
    await expect(stopListener(listener)).rejects.toThrow(
      "identity or owner changed"
    )
    expect(kill).not.toHaveBeenCalled()
  })
  it("uses SIGTERM once, waits, and never escalates to SIGKILL", async () => {
    const kill = vi.spyOn(process, "kill").mockReturnValue(true)
    vi.spyOn(process, "getuid").mockReturnValue(1000)
    mocks.execute.mockResolvedValue({ stdout: identity })
    await expect(stopListener(listener)).rejects.toThrow("No force-kill")
    expect(kill).toHaveBeenCalledExactlyOnceWith(1234, "SIGTERM")
    expect(mocks.delay).toHaveBeenCalledTimes(40)
  })
  it("parses executable paths with spaces without dropping identity", async () => {
    mocks.execute.mockResolvedValue({
      stdout: identity.replace("/usr/local/bin", "/Applications/My Tools")
    })
    expect(await processIdentity(1234)).toMatchObject({
      executable: "/Applications/My Tools/ollama",
      uid: 1000
    })
  })
  it("preserves Linux Ollama settings without copying unrelated secrets", async () => {
    Object.defineProperty(process, "platform", { value: "linux" })
    mocks.readFile.mockResolvedValue(
      "OLLAMA_MODELS=/data/my models\0AWS_SECRET_ACCESS_KEY=private\0OLLAMA_ORIGINS=https://existing.example\0"
    )
    expect(await ollamaEnvironment(listener)).toEqual({
      OLLAMA_MODELS: "/data/my models",
      OLLAMA_ORIGINS: "https://existing.example"
    })
  })
  it("preserves macOS Ollama values containing spaces", async () => {
    Object.defineProperty(process, "platform", { value: "darwin" })
    mocks.execute.mockResolvedValue({
      stdout:
        "ollama serve PATH=/bin OLLAMA_MODELS=/data/my models OLLAMA_ORIGINS=https://example.com OTHER_SECRET=hidden"
    })
    expect(await ollamaEnvironment(listener)).toEqual({
      OLLAMA_MODELS: "/data/my models",
      OLLAMA_ORIGINS: "https://example.com"
    })
  })
})

describe("manager ownership", () => {
  it("does not overwrite settings of a service whose environment is unavailable", async () => {
    await expect(
      managerEnvironment({ kind: "system-service" })
    ).rejects.toThrow("effective settings can be preserved")
    expect(mocks.writeFile).not.toHaveBeenCalled()
  })
  it("refuses a launchd-supervised child instead of killing it", async () => {
    Object.defineProperty(process, "platform", { value: "darwin" })
    mocks.execute
      .mockResolvedValueOnce({ stdout: "1" })
      .mockResolvedValueOnce({ stdout: "/sbin/launchd" })
      .mockResolvedValueOnce({
        stdout: "PID Status Label\n1234 0 homebrew.mxcl.ollama"
      })
    await expect(detectManager(listener)).rejects.toThrow(
      "supervised by launchd"
    )
  })
  it("refuses a Linux server owned by a different system service", async () => {
    Object.defineProperty(process, "platform", { value: "linux" })
    mocks.execute.mockResolvedValue({ stdout: "not-found" })
    mocks.readFile.mockResolvedValue("0::/system.slice/custom-ollama.service\n")
    await expect(detectManager(listener)).rejects.toThrow("another service")
  })

  it("recognizes the app owning the server instead of stopping its child", async () => {
    Object.defineProperty(process, "platform", { value: "darwin" })
    mocks.execute
      .mockResolvedValueOnce({ stdout: "333" })
      .mockResolvedValueOnce({
        stdout: "/Applications/Ollama.app/Contents/MacOS/Ollama"
      })
    expect(await detectManager(listener)).toEqual({
      kind: "mac-app",
      appPath: "/Applications/Ollama.app"
    })
  })
  it("does not mistake an unrelated installed systemd unit for the owner", async () => {
    Object.defineProperty(process, "platform", { value: "linux" })
    mocks.execute
      .mockResolvedValueOnce({ stdout: "loaded" })
      .mockResolvedValueOnce({ stdout: "9000" })
      .mockResolvedValueOnce({ stdout: "loaded" })
      .mockResolvedValueOnce({ stdout: "1234" })
    expect(await detectManager(listener)).toEqual({ kind: "user-service" })
  })
  it("stops before editing a system service when privileges are missing", async () => {
    vi.spyOn(process, "getuid").mockReturnValue(1000)
    await expect(
      applyManager(
        { kind: "system-service" },
        resolveOllamaOptions({ LAN: true }, {}, {}),
        {}
      )
    ).rejects.toThrow("sudo systemctl edit")
    expect(mocks.writeFile).not.toHaveBeenCalled()
    expect(mocks.execute).not.toHaveBeenCalled()
  })
  it("escapes systemd settings and uses a dedicated drop-in", async () => {
    vi.spyOn(process, "getuid").mockReturnValue(0)
    const options = resolveOllamaOptions(
      { LAN: true, ALLOWED_ORIGINS: 'https://example.com/100%"' },
      {},
      {}
    )
    await applyManager({ kind: "system-service" }, options, {})
    expect(mocks.writeFile).toHaveBeenCalledWith(
      "/etc/systemd/system/ollama.service.d/99-olc.conf",
      expect.stringContaining('100%%\\"'),
      { mode: 0o600 }
    )
    expect(mocks.execute).toHaveBeenCalledWith(
      "systemctl",
      ["restart", "ollama.service"],
      expect.any(Object)
    )
    expect(mocks.spawn).not.toHaveBeenCalled()
  })
  it("retains app environment when adding browser origins", async () => {
    Object.defineProperty(process, "platform", { value: "darwin" })
    mocks.execute
      .mockResolvedValueOnce({ stdout: "0.0.0.0:11434" })
      .mockResolvedValueOnce({ stdout: "https://existing.example" })
    expect(await managerEnvironment({ kind: "mac-app" })).toEqual({
      OLLAMA_HOST: "0.0.0.0:11434",
      OLLAMA_ORIGINS: "https://existing.example"
    })
  })
})
