import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { isAppError } from "@/lib/error-utils"
import { OllamaProvider } from "../ollama"
import { OpenAICompatibleProvider } from "../openai-compatible"
import { ProviderId, ProviderType } from "../types"

/*
 * Embedding responses are the one provider path consumed as raw numbers, so a
 * malformed success body has nowhere to surface: `data.data[0].embedding` on a
 * JSON error object threw an unclassified TypeError, and a vector holding null
 * or a string reached cosine similarity as NaN and quietly poisoned every
 * ranking it took part in. Both arrive as HTTP 200.
 */

const jsonResponse = (body: unknown): Response =>
  ({
    ok: true,
    status: 200,
    json: () => Promise.resolve(body)
  }) as unknown as Response

const errorResponse = (status: number, body: string): Response =>
  ({
    ok: false,
    status,
    text: () => Promise.resolve(body)
  }) as unknown as Response

const openAiProvider = () =>
  new OpenAICompatibleProvider({
    id: "custom:openai:test",
    type: ProviderType.OPENAI,
    name: "Test",
    baseUrl: "https://api.example.com/v1",
    enabled: true
  })

const ollamaProvider = () =>
  new OllamaProvider({
    id: ProviderId.OLLAMA,
    type: ProviderType.OLLAMA,
    name: "Ollama",
    baseUrl: "http://localhost:11434",
    enabled: true
  })

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn())
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe("OpenAI-compatible embeddings", () => {
  it("returns the vector for a well-formed response", async () => {
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse({ data: [{ embedding: [0.1, 0.2, 0.3] }] })
    )

    await expect(openAiProvider().embed("hello")).resolves.toEqual([
      0.1, 0.2, 0.3
    ])
  })

  it("rejects a success body that carries an error object instead of data", async () => {
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse({ error: { message: "quota exceeded" } })
    )

    const error = await openAiProvider()
      .embed("hello")
      .catch((thrown: unknown) => thrown)

    expect(isAppError(error)).toBe(true)
    if (isAppError(error)) {
      expect(error.phase).toBe("response")
      expect(error.kind).toBe("provider")
    }
  })

  it("rejects an empty data array", async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ data: [] }))

    await expect(openAiProvider().embed("hello")).rejects.toThrow()
  })

  it("rejects a vector containing a non-finite number", async () => {
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse({ data: [{ embedding: [0.1, Number.NaN, 0.3] }] })
    )

    await expect(openAiProvider().embed("hello")).rejects.toThrow()
  })

  it("rejects a vector containing a string", async () => {
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse({ data: [{ embedding: [0.1, "0.2", 0.3] }] })
    )

    await expect(openAiProvider().embed("hello")).rejects.toThrow()
  })

  it("rejects a batch whose vector count does not match the input count", async () => {
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse({ data: [{ embedding: [0.1, 0.2] }] })
    )

    await expect(
      openAiProvider().embedBatch(["one", "two", "three"])
    ).rejects.toThrow(/expected 3 vectors, received 1/)
  })

  it("orders batch vectors by the index the server reported", async () => {
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse({
        data: [
          { index: 1, embedding: [0.9] },
          { index: 0, embedding: [0.1] }
        ]
      })
    )

    await expect(
      openAiProvider().embedBatch(["first", "second"])
    ).resolves.toEqual([[0.1], [0.9]])
  })
})

describe("Ollama embeddings", () => {
  it("reads the current endpoint's embeddings array", async () => {
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse({ embeddings: [[0.1, 0.2]] })
    )

    await expect(ollamaProvider().embed("hello")).resolves.toEqual([0.1, 0.2])
  })

  /*
   * A malformed answer from /api/embed is not evidence that the legacy endpoint
   * is malformed too, so the fallback still runs — the same behaviour an empty
   * vector had before the response was validated.
   */
  it("falls back to the legacy endpoint when the current one answers with junk", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(jsonResponse({ embeddings: [] }))
      .mockResolvedValueOnce(jsonResponse({ embedding: [0.3, 0.4] }))

    await expect(ollamaProvider().embed("hello")).resolves.toEqual([0.3, 0.4])
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it("rejects when both endpoints answer with an invalid vector", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(jsonResponse({ embeddings: [[]] }))
      .mockResolvedValueOnce(jsonResponse({ embedding: [Number.NaN] }))

    const error = await ollamaProvider()
      .embed("hello")
      .catch((thrown: unknown) => thrown)

    expect(isAppError(error)).toBe(true)
    if (isAppError(error)) {
      expect(error.phase).toBe("response")
    }
  })

  it("sanitizes legacy endpoint bodies in the structured error", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(errorResponse(404, "apiKey=private-value"))
      .mockResolvedValueOnce(
        errorResponse(500, "stack trace and apiKey=private-value")
      )

    const error = await ollamaProvider()
      .embed("hello", "nomic-embed-text")
      .catch((thrown: unknown) => thrown)

    expect(isAppError(error)).toBe(true)
    if (isAppError(error)) {
      expect(error.userMessage).toContain("returned HTTP 500")
      expect(error.userMessage).not.toContain("private-value")
      expect(error.debug).toContain("private-value")
    }
  })

  it("does not try the legacy endpoint after the caller cancels", async () => {
    const controller = new AbortController()
    vi.mocked(fetch).mockImplementation(() => {
      controller.abort()
      return Promise.reject(controller.signal.reason)
    })

    await expect(
      ollamaProvider().embed("hello", undefined, controller.signal)
    ).rejects.toBeDefined()
    expect(fetch).toHaveBeenCalledTimes(1)
  })
})
