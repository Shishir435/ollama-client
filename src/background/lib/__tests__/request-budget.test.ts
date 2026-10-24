import { describe, expect, it } from "vitest"
import { packChatRequest, packProviderRequest } from "../request-budget"

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
    expect(packed.num_predict).toBeUndefined()
  })
  it.each([-1, 0, 2048])(
    "preserves the requested output setting %i",
    (num_predict) => {
      const request = {
        model: "test",
        messages: [{ role: "user" as const, content: "hello" }],
        num_predict
      }
      expect(packChatRequest(request, 8192).num_predict).toBe(num_predict)
    }
  )
  it("counts the adapter's actual default output without changing unlimited output", () => {
    const request = {
      model: "anthropic",
      num_predict: -1,
      messages: [{ role: "user" as const, content: "history ".repeat(1400) }]
    }
    expect(packChatRequest(request, 8192).num_predict).toBe(-1)
    expect(() => packChatRequest(request, 8192, 4096)).toThrow(/context window/)
    expect(
      packChatRequest({ ...request, num_predict: 512 }, 8192, 512).num_predict
    ).toBe(512)
    expect(() =>
      packChatRequest({ ...request, max_tokens: 6000 }, 8192, 6000)
    ).toThrow(/context window/)
  })
  it("uses the provider's resolved allowance for tool-loop synthesis too", () => {
    const provider = { getOutputTokenLimit: () => 4096 }
    const request = {
      model: "test",
      num_predict: -1,
      tool_choice: "none" as const,
      messages: [{ role: "user" as const, content: "history ".repeat(1400) }]
    }
    expect(() => packProviderRequest(provider, request, 8192)).toThrow(
      /context window/
    )
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
