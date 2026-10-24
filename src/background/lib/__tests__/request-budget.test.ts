import { describe, expect, it } from "vitest"
import { packChatRequest } from "../request-budget"

describe("complete provider request budget", () => {
  it("keeps system policy and a tool-call/result pair intact", () => {
    const messages = [
      { role: "system" as const, content: "policy" },
      { role: "user" as const, content: "question" },
      {
        role: "assistant" as const,
        content: "",
        toolCalls: [
          { id: "call", name: "file_search", arguments: { query: "question" } }
        ]
      },
      { role: "tool" as const, content: "evidence", toolCallId: "call" }
    ]
    const packed = packChatRequest({ model: "test", messages }, 4096)
    expect(packed.messages).toEqual(messages)
    expect(packed.num_predict).toBe(1024)
  })
  it("refuses oversized history rather than silently dropping messages", () => {
    expect(() =>
      packChatRequest(
        {
          model: "test",
          messages: [
            { role: "system", content: "policy" },
            { role: "user", content: "history".repeat(5000) }
          ]
        },
        2048
      )
    ).toThrow(/This request was not sent/)
  })
  it("counts image input and the output reserve", () => {
    expect(() =>
      packChatRequest(
        {
          model: "test",
          num_predict: 1024,
          messages: [
            {
              role: "user",
              content: "describe",
              images: [
                {
                  imageId: "1",
                  fileName: "image.png",
                  size: 10,
                  base64: "image",
                  mimeType: "image/png"
                }
              ]
            }
          ]
        },
        2048
      )
    ).toThrow()
  })
})
