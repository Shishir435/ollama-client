import { afterEach, describe, expect, it, vi } from "vitest"
import {
  codexMcpIsolation,
  createCodexMcpIsolationLoader,
  resolveCodexConfig
} from "../config.js"

const originalEnv = { ...process.env }

afterEach(() => {
  process.env = { ...originalEnv }
})

describe("resolveCodexConfig", () => {
  it("uses the Codex binary on PATH and an isolated temporary workspace", () => {
    const config = resolveCodexConfig()
    expect(config.CODEX_PATH).toBe("codex")
    expect(config.PROJECT_DIR).toContain("olc-codex-workspace")
    expect(config.WEB_SEARCH_MODE).toBe("cached")
  })

  it("keeps option, environment, file, default precedence", () => {
    process.env.OLC_CODEX_PATH = "/env/codex"
    expect(
      resolveCodexConfig({ fileOptions: { CODEX_PATH: "/file/codex" } })
        .CODEX_PATH
    ).toBe("/env/codex")
    expect(
      resolveCodexConfig({
        options: { CODEX_PATH: "/flag/codex" },
        fileOptions: { CODEX_PATH: "/file/codex" }
      }).CODEX_PATH
    ).toBe("/flag/codex")
  })

  it("accepts the backend-specific project directory", () => {
    process.env.OLC_CODEX_PROJECT_DIR = "/env/workspace"
    expect(resolveCodexConfig().PROJECT_DIR).toBe("/env/workspace")
    expect(
      resolveCodexConfig({
        options: { CODEX_PROJECT_DIR: "/flag/workspace" }
      }).PROJECT_DIR
    ).toBe("/flag/workspace")
  })

  it("resolves and validates the native web-search mode", () => {
    process.env.OLC_CODEX_WEB_SEARCH_MODE = "indexed"
    expect(resolveCodexConfig().WEB_SEARCH_MODE).toBe("indexed")
    expect(
      resolveCodexConfig({ options: { CODEX_WEB_SEARCH_MODE: "live" } })
        .WEB_SEARCH_MODE
    ).toBe("live")
    expect(() =>
      resolveCodexConfig({ options: { CODEX_WEB_SEARCH_MODE: "surprise" } })
    ).toThrow("Invalid Codex web-search mode 'surprise'")
  })
})

describe("codexMcpIsolation", () => {
  it("switches off every MCP server the merged config lists", () => {
    expect(
      codexMcpIsolation({
        config: { mcp_servers: { node_repl: {}, "computer-use": {} } },
        origins: {}
      })
    ).toEqual({
      "mcp_servers.node_repl.enabled": false,
      "mcp_servers.computer-use.enabled": false
    })
  })

  it.each([
    undefined,
    null,
    {},
    { config: {} },
    { config: { mcp_servers: [] } },
    { config: { mcp_servers: "x" } }
  ])("adds nothing for a config with no server table: %j", (read) => {
    expect(codexMcpIsolation(read)).toEqual({})
  })
})

describe("createCodexMcpIsolationLoader", () => {
  const listed = { config: { mcp_servers: { node_repl: {} } } }

  it("recovers after a failed start instead of keeping the failure", async () => {
    const start = vi
      .fn<() => Promise<void>>()
      .mockRejectedValueOnce(new Error("Codex app-server exited"))
      .mockResolvedValue(undefined)
    const load = createCodexMcpIsolationLoader({
      start,
      read: async () => listed,
      log: vi.fn()
    })
    expect(await load()).toEqual({})
    expect(await load()).toEqual({ "mcp_servers.node_repl.enabled": false })
    expect(start).toHaveBeenCalledTimes(2)
  })

  it("shares one listing between concurrent turns and keeps a success", async () => {
    const read = vi.fn(async () => listed)
    const load = createCodexMcpIsolationLoader({
      start: async () => undefined,
      read,
      log: vi.fn()
    })
    await Promise.all([load(), load(), load()])
    await load()
    expect(read).toHaveBeenCalledTimes(1)
  })

  it("asks again after a failed listing", async () => {
    const read = vi
      .fn<() => Promise<unknown>>()
      .mockRejectedValueOnce(new Error("config/read failed"))
      .mockResolvedValue(listed)
    const load = createCodexMcpIsolationLoader({
      start: async () => undefined,
      read,
      log: vi.fn()
    })
    expect(await load()).toEqual({})
    expect(await load()).toEqual({ "mcp_servers.node_repl.enabled": false })
  })
})
