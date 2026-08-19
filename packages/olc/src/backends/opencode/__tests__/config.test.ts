import { afterEach, describe, expect, it } from "vitest"
import { resolveOpencodeConfig } from "../config.js"

const originalEnv = { ...process.env }

afterEach(() => {
  process.env = { ...originalEnv }
})

const resolve = (
  options: Record<string, unknown> = {},
  fileOptions: Record<string, unknown> = {}
) => resolveOpencodeConfig({ options, fileOptions, port: 8083 })

describe("resolveOpencodeConfig", () => {
  it("defaults to a local OpenCode server and binary on PATH", () => {
    const config = resolve()
    expect(config.OPENCODE_SERVER_URL).toBe("http://127.0.0.1:4097")
    expect(config.OPENCODE_PATH).toBe("opencode")
    expect(config.OPENCODE_AGENT).toBe("")
  })

  it("keeps the same precedence as the core: options, env, file, default", () => {
    process.env.OPENCODE_SERVER_URL = "http://127.0.0.1:5000"
    expect(
      resolve({}, { OPENCODE_SERVER_URL: "http://127.0.0.1:4000" })
        .OPENCODE_SERVER_URL
    ).toBe("http://127.0.0.1:5000")
    expect(
      resolve(
        { OPENCODE_SERVER_URL: "http://127.0.0.1:6000" },
        { OPENCODE_SERVER_URL: "http://127.0.0.1:4000" }
      ).OPENCODE_SERVER_URL
    ).toBe("http://127.0.0.1:6000")
  })

  it("disables every OpenCode-native tool unless the operator lists some", () => {
    expect(resolve().ALLOW_OPENCODE_TOOLS).toEqual([])
    expect(
      resolve({ ALLOW_OPENCODE_TOOLS: "websearch, webfetch" })
        .ALLOW_OPENCODE_TOOLS
    ).toEqual(["websearch", "webfetch"])
    expect(
      resolve({}, { ALLOW_OPENCODE_TOOLS: ["websearch"] }).ALLOW_OPENCODE_TOOLS
    ).toEqual(["websearch"])
  })

  it("approves OpenCode's own permission prompts by default, since nothing can answer them", () => {
    expect(resolve().AUTO_APPROVE_PERMISSIONS).toBe(true)
    expect(
      resolve({ AUTO_APPROVE_PERMISSIONS: false }).AUTO_APPROVE_PERMISSIONS
    ).toBe(false)
  })

  it("scopes the generated plugin directory to the port it serves", () => {
    expect(
      resolveOpencodeConfig({ options: {}, fileOptions: {}, port: 8100 })
        .PLUGIN_DIR
    ).toContain("port-8100")
  })

  it("points at the plugin sources shipped beside it", () => {
    expect(resolve().PLUGIN_SOURCE_DIR.endsWith("plugin")).toBe(true)
  })
})
