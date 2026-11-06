import { describe, expect, it } from "vitest"
import { classifyEndpointScope, suggestSchemeFor } from "../endpoint-scope"

describe("classifyEndpointScope", () => {
  it.each([
    ["http://localhost:11434", "loopback"],
    ["http://127.0.0.1:8080/v1", "loopback"],
    ["http://[::1]:8080", "loopback"],
    ["http://app.localhost", "loopback"],
    ["http://10.0.0.5:1234", "local-network"],
    ["http://172.16.4.2", "local-network"],
    ["http://172.32.0.1", "remote"],
    ["http://192.168.1.20:1234/v1", "local-network"],
    ["http://169.254.10.1", "local-network"],
    ["http://nas.local:8080", "local-network"],
    ["http://studio", "local-network"],
    ["https://api.openai.com/v1", "remote"],
    ["https://8.8.8.8", "remote"],
    ["not a url", "invalid"],
    ["localhost:1234", "invalid"]
  ])("%s is %s", (url, scope) => {
    expect(classifyEndpointScope(url)).toBe(scope)
  })
})

describe("suggestSchemeFor", () => {
  it("suggests http:// for a scheme-less host", () => {
    expect(suggestSchemeFor("localhost:1234")).toBe("http://localhost:1234")
    expect(suggestSchemeFor("192.168.1.5:8080/v1")).toBe(
      "http://192.168.1.5:8080/v1"
    )
  })

  it("leaves a URL that already has a scheme alone", () => {
    expect(suggestSchemeFor("https://example.com")).toBeNull()
    expect(suggestSchemeFor("")).toBeNull()
  })
})
