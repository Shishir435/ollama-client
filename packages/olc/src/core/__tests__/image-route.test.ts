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
  generateImage?: AgentBackend["generateImage"],
  { resolveDelayMs = 0 }: { resolveDelayMs?: number } = {}
): AgentBackend => ({
  id: "fake",
  ensureReady: vi.fn(async () => {}),
  listModels: vi.fn(async () => []),
  resolveModel: vi.fn(async () => {
    if (resolveDelayMs)
      await new Promise((resolve) => setTimeout(resolve, resolveDelayMs))
    return { providerId: "fake", modelId: "image-model" }
  }),
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

  let lock = createRequestQueue()

  const start = async (
    activeBackend: AgentBackend,
    limits: { maxDepth?: number; maxWaitMs?: number } = {}
  ) => {
    const router = createRouter()
    lock = createRequestQueue(limits)
    registerImageRoutes(router, {
      backend: activeBackend,
      config: resolveConfig({ REQUEST_TIMEOUT_MS: 5_000 }),
      lock
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

  it("never starts an image request whose client left the queue", async () => {
    let releaseFirst: (() => void) | undefined
    const generated: string[] = []
    const generateImage = vi.fn(async (input: { prompt: string }) => {
      generated.push(input.prompt)
      if (input.prompt === "slow")
        await new Promise<void>((resolve) => (releaseFirst = resolve))
      return [{ b64Json: PNG }]
    })
    const url = await start(
      backend(generateImage as unknown as AgentBackend["generateImage"])
    )

    const holding = post(url, {
      model: "fake/image-model",
      prompt: "slow",
      response_format: "b64_json"
    })
    await new Promise((resolve) => setTimeout(resolve, 30))
    const abandoned = new AbortController()
    const queued = fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "fake/image-model",
        prompt: "abandoned",
        response_format: "b64_json"
      }),
      signal: abandoned.signal
    }).catch(() => undefined)

    await new Promise((resolve) => setTimeout(resolve, 30))
    abandoned.abort()
    await queued
    releaseFirst?.()
    await holding
    await new Promise((resolve) => setTimeout(resolve, 200))

    expect(generated).toEqual(["slow"])
  })

  describe("when the line is bounded", () => {
    const request = (prompt: string) => ({
      model: "fake/image-model",
      prompt,
      response_format: "b64_json"
    })

    it("answers 503 with Retry-After for a full line and never generates for it", async () => {
      let releaseFirst: (() => void) | undefined
      const generated: string[] = []
      const generateImage = vi.fn(async (input: { prompt: string }) => {
        generated.push(input.prompt)
        if (input.prompt === "slow")
          await new Promise<void>((resolve) => (releaseFirst = resolve))
        return [{ b64Json: PNG }]
      })
      const url = await start(
        backend(generateImage as unknown as AgentBackend["generateImage"]),
        { maxDepth: 1 }
      )

      const holding = post(url, request("slow"))
      await vi.waitFor(() => expect(lock.inspect().running).toBe(true))
      const waiting = post(url, request("waits"))
      await vi.waitFor(() => expect(lock.inspect().depth).toBe(1))

      const refused = await post(url, request("refused"))
      const body = (await refused.json()) as {
        error: { type: string; retry_after: number }
      }

      expect(refused.status).toBe(503)
      expect(Number(refused.headers.get("retry-after"))).toBeGreaterThanOrEqual(
        1
      )
      expect(body.error.type).toBe("ServiceUnavailable")
      expect(body.error.retry_after).toBe(
        Number(refused.headers.get("retry-after"))
      )

      releaseFirst?.()
      await holding
      await waiting
      expect(generated).toEqual(["slow", "waits"])
    })

    it("answers 503 with Retry-After once the wait expires and never generates for it", async () => {
      let releaseFirst: (() => void) | undefined
      const generated: string[] = []
      const generateImage = vi.fn(async (input: { prompt: string }) => {
        generated.push(input.prompt)
        await new Promise<void>((resolve) => (releaseFirst = resolve))
        return [{ b64Json: PNG }]
      })
      const url = await start(
        backend(generateImage as unknown as AgentBackend["generateImage"]),
        { maxWaitMs: 50 }
      )

      const holding = post(url, request("slow"))
      await vi.waitFor(() => expect(lock.inspect().running).toBe(true))

      const expired = await post(url, request("expires"))
      const body = (await expired.json()) as {
        error: { type: string; retry_after: number }
      }

      expect(expired.status).toBe(503)
      expect(Number(expired.headers.get("retry-after"))).toBeGreaterThanOrEqual(
        1
      )
      expect(body.error.retry_after).toBeGreaterThanOrEqual(1)

      releaseFirst?.()
      await holding
      expect(generated).toEqual(["slow"])
    })
  })

  it("never queues an image request whose client left during model resolution", async () => {
    const generateImage = vi.fn(async () => [{ b64Json: PNG }])
    const url = await start(
      backend(generateImage as unknown as AgentBackend["generateImage"], {
        resolveDelayMs: 150
      })
    )
    const leaving = new AbortController()
    const cancelled = fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "fake/image-model",
        prompt: "abandoned",
        response_format: "b64_json"
      }),
      signal: leaving.signal
    }).catch(() => undefined)

    await new Promise((resolve) => setTimeout(resolve, 40))
    leaving.abort()
    await cancelled
    await new Promise((resolve) => setTimeout(resolve, 300))

    expect(generateImage).not.toHaveBeenCalled()
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
