import { afterEach, describe, expect, it } from "vitest"
import { codexMcpIsolation, resolveCodexConfig } from "../config.js"

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
