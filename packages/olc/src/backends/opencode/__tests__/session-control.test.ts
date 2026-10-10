import { describe, expect, it } from "vitest"
import { assertSessionControl } from "../index.js"

describe("assertSessionControl", () => {
  it("passes a session call the server accepted", () => {
    expect(() =>
      assertSessionControl({ data: true, response: { status: 200 } }, "delete")
    ).not.toThrow()
    expect(() => assertSessionControl(undefined, "delete")).not.toThrow()
  })

  it("throws on a refusal the SDK returned instead of throwing", () => {
    expect(() =>
      assertSessionControl(
        { error: { name: "NotFoundError" }, response: { status: 404 } },
        "delete"
      )
    ).toThrow("OpenCode refused session delete (HTTP 404)")
  })
})
