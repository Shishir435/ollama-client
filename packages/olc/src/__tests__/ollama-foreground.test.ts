import { afterEach, describe, expect, it, vi } from "vitest"

vi.mock("../ollama/runner.js", () => ({ probeOllama: vi.fn() }))
vi.mock("node:timers/promises", () => ({
  setTimeout: vi.fn().mockResolvedValue(undefined)
}))

import { monitorOllama } from "../ollama/foreground.js"
import { probeOllama } from "../ollama/runner.js"

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe("adopted Ollama foreground monitoring", () => {
  it("Ctrl-C stops only the observer, never the adopted server", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {})
    const kill = vi.spyOn(process, "kill")
    const before = process.listeners("SIGINT")
    const finished = monitorOllama("http://127.0.0.1:11434", [], true)
    const interrupt = process
      .listeners("SIGINT")
      .find((listener) => !before.includes(listener))
    interrupt?.("SIGINT")
    expect(await finished).toBe(130)
    expect(kill).not.toHaveBeenCalled()
    expect(process.listeners("SIGINT")).toEqual(before)
  })
  it("exits when the adopted server becomes unavailable", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {})
    vi.mocked(probeOllama).mockResolvedValue({ ready: false })
    const finished = monitorOllama("http://127.0.0.1:11434", [], true)
    expect(await finished).toBe(1)
  })
})
