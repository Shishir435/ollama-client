import { describe, expect, it } from "vitest"
import { parseArgs } from "../cli.js"
import { SHORT_FLAG_ALIASES } from "../cli-options.js"

describe("parseArgs", () => {
  it("gives every public option a unique one-letter alias", () => {
    const aliases = Object.keys(SHORT_FLAG_ALIASES)
    expect(new Set(aliases).size).toBe(aliases.length)
    expect(aliases.every((alias) => /^-[A-Za-z]$/.test(alias))).toBe(true)
    expect(Object.values(SHORT_FLAG_ALIASES)).toEqual(
      expect.arrayContaining([
        "--backend",
        "--host",
        "--port",
        "--allowed-origins",
        "--config",
        "--detached",
        "--foreground",
        "--debug",
        "--lan",
        "--local",
        "--ollama",
        "--check",
        "--json",
        "--api-key",
        "--system-prompt",
        "--no-bridge",
        "--opencode-url",
        "--opencode",
        "--agent",
        "--project-dir",
        "--allow-opencode-tools",
        "--plugin-dir",
        "--codex",
        "--codex-project-dir",
        "--codex-web-search",
        "--help"
      ])
    )
  })
  it.each([
    ["-b", "codex", "BACKEND"],
    ["-H", "0.0.0.0", "BIND_HOST"],
    ["-p", "9000", "PORT"],
    ["-o", "https://app.test", "ALLOWED_ORIGINS"],
    ["-O", "/opt/ollama", "OLLAMA_PATH"],
    ["-K", "secret", "API_KEY"],
    ["-s", "prompt", "SYSTEM_PROMPT"],
    ["-u", "http://localhost:4097", "OPENCODE_SERVER_URL"],
    ["-x", "/opt/opencode", "OPENCODE_PATH"],
    ["-a", "build", "OPENCODE_AGENT"],
    ["-P", "/project", "PROJECT_DIR"],
    ["-t", "read,write", "ALLOW_OPENCODE_TOOLS"],
    ["-g", "/plugins", "PLUGIN_DIR"],
    ["-C", "/opt/codex", "CODEX_PATH"],
    ["-W", "/workspace", "CODEX_PROJECT_DIR"],
    ["-w", "live", "CODEX_WEB_SEARCH_MODE"]
  ])("maps short value flag %s", (flag, value, key) => {
    expect(parseArgs([flag, value]).options).toEqual({ [key]: value })
  })
  it.each([
    ["-D", "DETACHED", true],
    ["-f", "FOREGROUND", true],
    ["-d", "DEBUG", true],
    ["-l", "LAN", true],
    ["-L", "LOCAL", true],
    ["-k", "CHECK", true],
    ["-j", "JSON", true],
    ["-n", "BRIDGE_ENABLED", false]
  ])("maps short boolean flag %s", (flag, key, value) => {
    expect(parseArgs([flag]).options).toEqual({ [key]: value })
  })
  it("maps short config/help and detects duplicates across aliases", () => {
    expect(parseArgs(["-c", "/tmp/olc.json"]).configPath).toBe("/tmp/olc.json")
    expect(parseArgs(["-h"]).help).toBe(true)
    expect(() => parseArgs(["-b", "codex", "--backend", "opencode"])).toThrow(
      "more than once"
    )
    expect(() => parseArgs(["-p"])).toThrow("-p needs a value")
  })
  it("maps flags onto proxy options", () => {
    const { options } = parseArgs([
      "--port",
      "9001",
      "--host",
      "0.0.0.0",
      "--opencode-url",
      "http://127.0.0.1:4444",
      "--allow-opencode-tools",
      "websearch",
      "--codex",
      "/opt/codex",
      "--codex-project-dir",
      "/tmp/codex-empty",
      "--codex-web-search",
      "indexed"
    ])

    expect(options).toEqual({
      PORT: "9001",
      BIND_HOST: "0.0.0.0",
      OPENCODE_SERVER_URL: "http://127.0.0.1:4444",
      ALLOW_OPENCODE_TOOLS: "websearch",
      CODEX_PATH: "/opt/codex",
      CODEX_PROJECT_DIR: "/tmp/codex-empty",
      CODEX_WEB_SEARCH_MODE: "indexed"
    })
  })

  it("handles boolean flags and help", () => {
    expect(parseArgs(["--debug", "--no-bridge"]).options).toEqual({
      DEBUG: true,
      BRIDGE_ENABLED: false
    })
    expect(parseArgs(["--help"]).help).toBe(true)
  })

  it("parses Docker backends and their start port", () => {
    expect(parseArgs(["list", "--json"])).toMatchObject({
      command: "list",
      options: { JSON: true }
    })
    expect(parseArgs(["-b", "laya", "--port", "8087"])).toMatchObject({
      command: "laya",
      action: "start",
      options: { PORT: "8087" }
    })
    expect(parseArgs(["--backend=laya", "status"])).toMatchObject({
      command: "laya",
      action: "status"
    })
    expect(parseArgs(["-b", "searxng", "status"])).toMatchObject({
      command: "searxng",
      action: "status"
    })
    expect(parseArgs(["-b", "laya", "rm"])).toMatchObject({
      command: "laya",
      action: "rm"
    })
    expect(parseArgs(["-b", "searxng", "rm", "--purge-data"])).toMatchObject({
      command: "searxng",
      action: "rm",
      options: { PURGE_DATA: true }
    })
    expect(() => parseArgs(["-b", "laya", "stop", "--purge-data"])).toThrow(
      "--purge-data is only supported by"
    )
    expect(() => parseArgs(["--purge-data"])).toThrow(
      "--purge-data is only supported by"
    )
    expect(() => parseArgs(["-b", "laya", "--codex", "/opt/codex"])).toThrow(
      "--codex is not supported by olc laya start"
    )
    expect(() =>
      parseArgs(["-b", "searxng", "status", "--port", "8081"])
    ).toThrow("--port is not supported by olc searxng status")
    expect(() => parseArgs(["list", "--port", "8081"])).toThrow(
      "--port is not supported by olc list"
    )
  })

  it("reads an alternate config path", () => {
    expect(parseArgs(["--config", "/tmp/oc.json"]).configPath).toBe(
      "/tmp/oc.json"
    )
  })

  it("rejects an unknown flag instead of ignoring it", () => {
    expect(() => parseArgs(["--nope"])).toThrow("Unknown option: --nope")
    expect(() => parseArgs(["--port"])).toThrow("--port needs a value")
  })
})
