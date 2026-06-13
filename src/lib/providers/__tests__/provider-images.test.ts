import { afterEach, describe, expect, it, vi } from "vitest"

import { OllamaProvider } from "../ollama"
import { OpenAICompatibleProvider } from "../openai-compatible"
import { type ChatRequest, type ProviderConfig, ProviderType } from "../types"

const fakeStreamResponse = () =>
  ({
    ok: true,
    status: 200,
    body: {
      getReader: () => ({
        read: vi.fn().mockResolvedValue({ done: true, value: undefined }),
        releaseLock: vi.fn()
      })
    },
    text: async () => ""
  }) as unknown as Response

const bodyOf = (fetchMock: ReturnType<typeof vi.spyOn>) =>
  JSON.parse((fetchMock.mock.calls[0]?.[1] as RequestInit).body as string)

const imageRequest: ChatRequest = {
  model: "m",
  messages: [
    {
      role: "user",
      content: "what is this?",
      images: [
        {
          imageId: "i",
          fileName: "a.png",
          mimeType: "image/png",
          size: 3,
          base64: "AAA"
        }
      ]
    }
  ]
}

const ollamaConfig: ProviderConfig = {
  id: "ollama",
  type: ProviderType.OLLAMA,
  enabled: true,
  baseUrl: "http://localhost:11434",
  name: "Ollama"
}

const openaiConfig: ProviderConfig = {
  id: "x",
  type: ProviderType.OPENAI,
  enabled: true,
  baseUrl: "http://localhost:8000/v1",
  name: "X"
}

describe("provider image input", () => {
  afterEach(() => vi.restoreAllMocks())

  it("Ollama sends images as raw base64 on the message", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(fakeStreamResponse())

    await new OllamaProvider(ollamaConfig).streamChat(imageRequest, () => {})

    const body = bodyOf(fetchMock)
    expect(body.messages[0].images).toEqual(["AAA"])
    expect(body.messages[0].content).toBe("what is this?")
  })

  it("OpenAI-compatible sends images as image_url content parts", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(fakeStreamResponse())

    await new OpenAICompatibleProvider(openaiConfig).streamChat(
      imageRequest,
      () => {}
    )

    const content = bodyOf(fetchMock).messages[0].content
    expect(content[0]).toEqual({ type: "text", text: "what is this?" })
    expect(content[1]).toEqual({
      type: "image_url",
      image_url: { url: "data:image/png;base64,AAA" }
    })
  })

  it("OpenAI-compatible keeps plain string content when no images", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(fakeStreamResponse())

    await new OpenAICompatibleProvider(openaiConfig).streamChat(
      { model: "m", messages: [{ role: "user", content: "hi" }] },
      () => {}
    )

    expect(bodyOf(fetchMock).messages[0].content).toBe("hi")
  })
})
