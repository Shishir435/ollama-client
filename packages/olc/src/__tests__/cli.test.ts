import { describe, expect, it } from "vitest"
import { parseArgs } from "../cli.js"

describe("parseArgs", () => {
  it("maps flags onto proxy options", () => {
    const { options } = parseArgs([
      "--port",
      "9001",
      "--host",
      "0.0.0.0",
      "--opencode-url",
      "http://127.0.0.1:4444",
      "--allow-opencode-tools",
      "websearch"
    ])

    expect(options).toEqual({
      PORT: "9001",
      BIND_HOST: "0.0.0.0",
      OPENCODE_SERVER_URL: "http://127.0.0.1:4444",
      ALLOW_OPENCODE_TOOLS: "websearch"
    })
  })

  it("handles boolean flags and help", () => {
    expect(parseArgs(["--debug", "--no-bridge"]).options).toEqual({
      DEBUG: true,
      BRIDGE_ENABLED: false
    })
    expect(parseArgs(["--help"]).help).toBe(true)
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
