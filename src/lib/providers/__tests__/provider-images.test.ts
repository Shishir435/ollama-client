import { afterEach, describe, expect, it, vi } from "vitest"
import type { ChatStreamMessage } from "@/types"
import { OllamaProvider } from "../ollama"
import { OpenAICompatibleProvider } from "../openai-compatible"
import { type ChatRequest, type ProviderConfig, ProviderType } from "../types"

const ONE_PIXEL_PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAF/gL+NwL6WQAAAABJRU5ErkJggg=="

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
  JSON.parse((fetchMock.mock.calls[0]![1] as RequestInit).body as string)

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

describe("provider image output", () => {
  afterEach(() => vi.restoreAllMocks())

  it("normalizes OpenAI-compatible image generations into chat chunks", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ data: [{ b64_json: ONE_PIXEL_PNG }] }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      })
    )
    const chunks: ChatStreamMessage[] = []

    await new OpenAICompatibleProvider(openaiConfig).generateImage?.(
      { model: "image-model", prompt: "a small red square" },
      (chunk) => chunks.push(chunk)
    )

    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:8000/v1/images/generations",
      expect.objectContaining({ method: "POST" })
    )
    expect(bodyOf(fetchMock)).toMatchObject({
      model: "image-model",
      prompt: "a small red square",
      response_format: "b64_json"
    })
    expect(chunks[0]).toMatchObject({
      done: true,
      generatedImages: [
        {
          mimeType: "image/png",
          origin: "model-generated",
          generatedBy: { providerId: "x", model: "image-model" }
        }
      ]
    })
  })

  it("normalizes Ollama image generation NDJSON into chat chunks", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(
        new Response(
          `${JSON.stringify({ completed: 1, total: 2, done: false })}\n${JSON.stringify({ image: ONE_PIXEL_PNG, done: true })}\n`,
          { status: 200 }
        )
      )
    const chunks: ChatStreamMessage[] = []

    await new OllamaProvider(ollamaConfig).generateImage?.(
      { model: "x/z-image-turbo", prompt: "a fox" },
      (chunk) => chunks.push(chunk)
    )

    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:11434/api/generate",
      expect.objectContaining({ method: "POST" })
    )
    expect(chunks).toHaveLength(1)
    expect(chunks[0]).toMatchObject({
      done: true,
      generatedImages: [{ mimeType: "image/png" }]
    })
  })

  it("falls back to inline chat images when a compatible server has no Images endpoint", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response("missing", { status: 404 }))
      .mockResolvedValueOnce(
        new Response(
          `data: ${JSON.stringify({ choices: [{ delta: { content: [{ type: "output_image", b64_json: ONE_PIXEL_PNG }] } }] })}\n\ndata: [DONE]\n\n`,
          { status: 200 }
        )
      )
    const chunks: ChatStreamMessage[] = []

    await new OpenAICompatibleProvider(openaiConfig).generateImage?.(
      { model: "inline-image-model", prompt: "a fox" },
      (chunk) => chunks.push(chunk)
    )

    expect(chunks.some((chunk) => chunk.generatedImages?.length === 1)).toBe(
      true
    )
    expect(chunks.at(-1)?.done).toBe(true)
  })
  it("falls back to chat when a 200 body reports the Images endpoint is missing", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        Response.json({
          error: "Unexpected endpoint or method. (POST /v1/images/generations)"
        })
      )
      .mockResolvedValueOnce(
        new Response(
          `data: ${JSON.stringify({ choices: [{ delta: { content: "hi" } }] })}\n\ndata: [DONE]\n\n`,
          { status: 200 }
        )
      )
    const chunks: ChatStreamMessage[] = []

    await new OpenAICompatibleProvider(openaiConfig).generateImage?.(
      { model: "google/gemma-4-26b-a4b", prompt: "hello" },
      (chunk) => chunks.push(chunk)
    )

    expect(fetchMock).toHaveBeenLastCalledWith(
      "http://localhost:8000/v1/chat/completions",
      expect.objectContaining({ method: "POST" })
    )
    expect(chunks.at(-1)?.done).toBe(true)
  })

  it("reports a server error carried in a 200 image response", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      Response.json({ error: { message: "Model failed to load" } })
    )

    await expect(
      new OpenAICompatibleProvider(openaiConfig).generateImage?.(
        { model: "image-model", prompt: "a fox" },
        () => {}
      )
    ).rejects.toMatchObject({
      kind: "provider",
      message: "Image generation error: Model failed to load",
      userMessage: expect.stringContaining(
        "reported an error instead of an image"
      )
    })
  })

  it("surfaces an HTTP 500 from the Images endpoint as a server error", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response("boom", { status: 500 })
    )

    const failure = await new OpenAICompatibleProvider(openaiConfig)
      .generateImage?.({ model: "image-model", prompt: "a fox" }, () => {})
      .catch((error: unknown) => error)

    expect(failure).toMatchObject({ kind: "provider", status: 500 })
    expect((failure as { userMessage?: string }).userMessage).not.toContain(
      "invalid image generation response"
    )
  })
})
