import { describe, expect, it } from "vitest"
import { getMessageType } from "@/protocol/message-type"

describe("getMessageType", () => {
  it("returns string discriminators", () => {
    expect(getMessageType({ type: "chat_chunk" })).toBe("chat_chunk")
  })

  it.each([
    null,
    [],
    {},
    { type: 1 },
    "chat_chunk"
  ])("rejects malformed input %#", (value) => {
    expect(getMessageType(value)).toBeUndefined()
  })
})
