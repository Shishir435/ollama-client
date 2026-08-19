import { afterEach, describe, expect, it } from "vitest"
import { loopbackHost, resolveConfig } from "../config.js"

const originalEnv = { ...process.env }

afterEach(() => {
  process.env = { ...originalEnv }
})

describe("resolveConfig", () => {
  it("prefers explicit options over the environment and defaults", () => {
    process.env.OLC_PORT = "9000"
    expect(resolveConfig({ PORT: 9100 }).PORT).toBe(9100)
  })

  it("falls back to the environment, then the config file, then the default", () => {
    process.env.OLC_PORT = "9000"
    expect(resolveConfig({}, { PORT: 8500 }).PORT).toBe(9000)
    delete process.env.OLC_PORT
    expect(resolveConfig({}, { PORT: 8500 }).PORT).toBe(8500)
    expect(resolveConfig().PORT).toBe(8083)
  })

  it("still reads the legacy OPENCODE_PROXY_ environment names", () => {
    process.env.OPENCODE_PROXY_PORT = "9200"
    expect(resolveConfig().PORT).toBe(9200)
  })

  it("serves the opencode backend unless another is selected", () => {
    expect(resolveConfig().BACKEND).toBe("opencode")
    expect(resolveConfig({ BACKEND: "other" }).BACKEND).toBe("other")
    process.env.OLC_BACKEND = "from-env"
    expect(resolveConfig().BACKEND).toBe("from-env")
  })

  it("enables the tool bridge by default and honours an explicit opt-out", () => {
    expect(resolveConfig().BRIDGE_ENABLED).toBe(true)
    expect(resolveConfig({ BRIDGE_ENABLED: false }).BRIDGE_ENABLED).toBe(false)
    process.env.OLC_BRIDGE_ENABLED = "0"
    expect(resolveConfig().BRIDGE_ENABLED).toBe(false)
  })

  it("generates a distinct bridge token per run when none is configured", () => {
    const first = resolveConfig().BRIDGE_TOKEN
    const second = resolveConfig().BRIDGE_TOKEN
    expect(first).toHaveLength(48)
    expect(first).not.toBe(second)
    expect(resolveConfig({ BRIDGE_TOKEN: "fixed" }).BRIDGE_TOKEN).toBe("fixed")
  })

  it("builds a loopback bridge endpoint even when bound to every interface", () => {
    expect(
      resolveConfig({ PORT: 8100, BIND_HOST: "0.0.0.0" }).BRIDGE_ENDPOINT
    ).toBe("http://127.0.0.1:8100/bridge/call")
  })

  it("allows only extension origins until told otherwise", () => {
    expect(resolveConfig().ALLOWED_ORIGINS).toEqual([
      "chrome-extension://*",
      "moz-extension://*",
      "safari-web-extension://*"
    ])
    expect(
      resolveConfig({ ALLOWED_ORIGINS: "http://localhost:3000" })
        .ALLOWED_ORIGINS
    ).toEqual(["http://localhost:3000"])
    process.env.OLC_ALLOWED_ORIGINS = "https://a.example,https://b.example"
    expect(resolveConfig().ALLOWED_ORIGINS).toEqual([
      "https://a.example",
      "https://b.example"
    ])
  })

  it("keeps backend-specific options out of the core config", () => {
    const config = resolveConfig({ OPENCODE_SERVER_URL: "http://127.0.0.1:1" })
    expect(config).not.toHaveProperty("OPENCODE_SERVER_URL")
    expect(config).not.toHaveProperty("ALLOW_OPENCODE_TOOLS")
  })
})

describe("loopbackHost", () => {
  it("keeps loopback addresses and rewrites anything else", () => {
    expect(loopbackHost("127.0.0.1")).toBe("127.0.0.1")
    expect(loopbackHost("localhost")).toBe("localhost")
    expect(loopbackHost("0.0.0.0")).toBe("127.0.0.1")
  })
})
