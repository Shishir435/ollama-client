import { describe, expect, it } from "vitest"
import { matchRoute } from "../http.js"

describe("matchRoute", () => {
  it("matches fixed paths exactly", () => {
    expect(matchRoute("/v1/models", "/v1/models")).toEqual({})
    expect(matchRoute("/v1/models", "/v1/models/extra")).toBeNull()
    expect(matchRoute("/v1/models", "/v1")).toBeNull()
  })

  it("captures a single dynamic segment", () => {
    expect(matchRoute("/v1/models/:modelId", "/v1/models/gpt-4o")).toEqual({
      modelId: "gpt-4o"
    })
  })

  it("decodes an encoded segment so provider-prefixed ids survive", () => {
    expect(
      matchRoute(
        "/v1/models/:modelId",
        "/v1/models/opencode%2Flaguna-s-2.1-free"
      )
    ).toEqual({ modelId: "opencode/laguna-s-2.1-free" })
  })

  it("ignores trailing slashes", () => {
    expect(matchRoute("/health", "/health/")).toEqual({})
  })
})
