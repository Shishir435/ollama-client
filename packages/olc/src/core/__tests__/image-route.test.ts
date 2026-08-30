import { createServer, type Server } from "node:http"
import type { AddressInfo } from "node:net"
import { afterEach, describe, expect, it, vi } from "vitest"
import type { AgentBackend } from "../../backends/types.js"
import { resolveConfig } from "../../config.js"
import { createRouter } from "../http.js"
import { registerImageRoutes } from "../image-route.js"
import { createRequestQueue } from "../queue.js"

const PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nXsAAAAASUVORK5CYII="

const backend = (
  generateImage?: AgentBackend["generateImage"]
): AgentBackend => ({
  id: "fake",
  ensureReady: vi.fn(async () => {}),
  listModels: vi.fn(async () => []),
  resolveModel: vi.fn(async () => ({
    providerId: "fake",
    modelId: "image-model"
  })),
  startTurn: vi.fn(async () => {
    throw new Error("not used")
  }),
  ...(generateImage ? { generateImage } : {}),
  findTurn: () => undefined,
  shutdown: vi.fn(async () => {})
})
describe("image generations route", () => {
  let server: Server | null = null

  afterEach(async () => {
    if (server) {
      await new Promise<void>((resolve) => server?.close(() => resolve()))
      server = null
    }
  })

  const start = async (activeBackend: AgentBackend) => {
    const router = createRouter()
    registerImageRoutes(router, {
      backend: activeBackend,
      config: resolveConfig({ REQUEST_TIMEOUT_MS: 5_000 }),
      lock: createRequestQueue()
    })
    server = createServer((request, response) => {
      void router.handle(request, response)
    })
    await new Promise<void>((resolve) =>
      server?.listen(0, "127.0.0.1", resolve)
    )
    const { port } = server.address() as AddressInfo
    return `http://127.0.0.1:${port}/v1/images/generations`
  }

  const post = (url: string, body: unknown) =>
    fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    })

  it("returns Codex image bytes in the OpenAI b64_json envelope", async () => {
    const generateImage = vi.fn(async () => [
      { b64Json: PNG, revisedPrompt: "A tiny red square" }
    ])
    const url = await start(backend(generateImage))

    const response = await post(url, {
      model: "codex/image-model",
      prompt: "draw a red square",
      response_format: "b64_json"
    })

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      data: [{ b64_json: PNG, revised_prompt: "A tiny red square" }]
    })
    expect(generateImage).toHaveBeenCalledWith(
      expect.objectContaining({
        model: { providerId: "fake", modelId: "image-model" },
        prompt: "draw a red square",
        signal: expect.any(AbortSignal)
      })
    )
  })

  it("rejects unsupported response shapes deterministically", async () => {
    const url = await start(backend(vi.fn(async () => [])))
    const response = await post(url, {
      prompt: "draw two cats",
      n: 2,
      response_format: "url"
    })

    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({
      error: { message: "only n=1 is supported", type: "BadRequest" }
    })
  })

  it("returns 501 when the selected runtime has no image operation", async () => {
    const url = await start(backend())
    const response = await post(url, { prompt: "draw a fox" })

    expect(response.status).toBe(501)
    expect(await response.json()).toMatchObject({
      error: { type: "UnsupportedOperation" }
    })
  })
})
