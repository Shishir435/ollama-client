import { describe, expect, it } from "vitest"
import { routeOpencodeWebSearch } from "../web-search.js"

const tool = (name: string) => ({
  type: "function",
  function: { name, parameters: { type: "object" } }
})

const searchTool = (source: "auto" | "client" | "native") => ({
  type: "function",
  function: {
    name: "web_search",
    parameters: {
      type: "object",
      "x-ollama-client-web-search": { source, mode: "live" }
    }
  }
})

describe("routeOpencodeWebSearch", () => {
  it("uses native search when OpenCode reports it", () => {
    const lookup = tool("lookup")
    expect(
      routeOpencodeWebSearch({
        tools: [tool("web_search"), lookup],
        discoveredIds: ["bash", "websearch", "webfetch"],
        operatorAllowedTools: ["bash"]
      })
    ).toEqual({
      native: true,
      bridgeTools: [lookup],
      allowedNativeTools: ["bash", "websearch"]
    })
  })

  it("keeps the client search fallback when native search is absent", () => {
    const tools = [tool("web_search")]
    expect(
      routeOpencodeWebSearch({
        tools,
        discoveredIds: ["bash"],
        operatorAllowedTools: ["websearch", "webfetch"]
      })
    ).toEqual({
      native: false,
      bridgeTools: tools,
      allowedNativeTools: []
    })
  })

  it("disables search when the turn did not opt in", () => {
    const lookup = tool("lookup")
    expect(
      routeOpencodeWebSearch({
        tools: [lookup],
        discoveredIds: ["websearch", "webfetch"],
        operatorAllowedTools: ["websearch", "webfetch"]
      })
    ).toEqual({
      native: false,
      bridgeTools: [lookup],
      allowedNativeTools: []
    })
  })

  it("enables webfetch only after both turn and operator opt in", () => {
    expect(
      routeOpencodeWebSearch({
        tools: [tool("web_search")],
        discoveredIds: ["websearch", "webfetch"],
        operatorAllowedTools: ["webfetch"]
      }).allowedNativeTools
    ).toEqual(["websearch", "webfetch"])
  })

  it("keeps client mode local and makes unavailable native mode fail closed", () => {
    const client = searchTool("client")
    expect(
      routeOpencodeWebSearch({
        tools: [client],
        discoveredIds: ["websearch"],
        operatorAllowedTools: []
      })
    ).toMatchObject({ native: false, bridgeTools: [client] })

    expect(
      routeOpencodeWebSearch({
        tools: [searchTool("native")],
        discoveredIds: [],
        operatorAllowedTools: []
      })
    ).toMatchObject({ native: false, bridgeTools: [] })
  })
})
