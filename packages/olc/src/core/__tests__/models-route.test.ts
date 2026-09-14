import { createServer, type Server } from "node:http"
import type { AddressInfo } from "node:net"
import { afterEach, describe, expect, it, vi } from "vitest"
import type { AgentBackend, CatalogModel } from "../../backends/types.js"
import { createRouter } from "../http.js"
import { registerModelRoutes } from "../models-route.js"

const models: CatalogModel[] = [
  {
    id: "opencode/model-a",
    object: "model",
    created: 1,
    owned_by: "opencode",
    name: "Model A",
    input_modalities: ["text"],
    supported_parameters: ["tools"],
    capabilities: {
      function_calling: true,
      vision: false,
      reasoning: false
    }
  },
  {
    id: "model-b",
    object: "model",
    created: 2,
    owned_by: "local",
    name: "Model B",
    input_modalities: ["text"],
    supported_parameters: [],
    capabilities: {
      function_calling: false,
      vision: false,
      reasoning: false
    }
  }
]

const backend = (listModels = vi.fn(async () => models)): AgentBackend => ({
  id: "fake",
  ensureReady: vi.fn(async () => {}),
  listModels,
  resolveModel: vi.fn(async () => ({ providerId: "fake", modelId: "a" })),
  startTurn: vi.fn(async () => {
    throw new Error("not used")
  }),
  findTurn: () => undefined,
  shutdown: vi.fn(async () => {})
})

describe("model catalog routes", () => {
  let server: Server | null = null

  afterEach(async () => {
    if (server) {
      await new Promise<void>((resolve) => server?.close(() => resolve()))
      server = null
    }
  })

  const start = async (activeBackend: AgentBackend, log = vi.fn()) => {
    const router = createRouter()
    registerModelRoutes(router, { backend: activeBackend, log })
    server = createServer((request, response) => {
      void router.handle(request, response)
    })
    await new Promise<void>((resolve) =>
      server?.listen(0, "127.0.0.1", resolve)
    )
    const { port } = server.address() as AddressInfo
    return { baseUrl: `http://127.0.0.1:${port}`, log }
  }

  it("returns the complete backend catalog", async () => {
    const { baseUrl, log } = await start(backend())

    const response = await fetch(`${baseUrl}/v1/models`)

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ object: "list", data: models })
    expect(log).toHaveBeenCalledWith("GET /v1/models ok", { count: 2 })
  })

  it("starts the backend before reading its catalog", async () => {
    /*
     * The proxy listens before `ensureReady` has resolved, so a catalog read
     * can arrive while the runtime is still coming up. The chat and image
     * routes have always started it first; this one asked straight away and
     * answered 502 — and a missing catalog is not a failure a client retries,
     * so the model menu simply showed a provider that lists nothing until some
     * later chat request happened to start the backend.
     */
    const order: string[] = []
    const ready = vi.fn(async () => {
      order.push("ensureReady")
    })
    const list = vi.fn(async () => {
      order.push("listModels")
      return models
    })
    const { baseUrl } = await start({ ...backend(list), ensureReady: ready })

    await fetch(`${baseUrl}/v1/models`)
    await fetch(`${baseUrl}/v1/models/model-b`)

    expect(order).toEqual([
      "ensureReady",
      "listModels",
      "ensureReady",
      "listModels"
    ])
  })

  it("finds a model by its full id", async () => {
    const { baseUrl } = await start(backend())

    const response = await fetch(`${baseUrl}/v1/models/model-b`)

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ id: "model-b" })
  })

  it("finds a provider-prefixed model by its short id", async () => {
    const { baseUrl } = await start(backend())

    const response = await fetch(`${baseUrl}/v1/models/model-a`)

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ id: "opencode/model-a" })
  })

  it("returns 404 for an unknown model", async () => {
    const { baseUrl } = await start(backend())

    const response = await fetch(`${baseUrl}/v1/models/missing`)

    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({
      error: { message: "Model not found" }
    })
  })

  it.each([
    "/v1/models",
    "/v1/models/model-a"
  ])("maps backend catalog failures on %s to 502", async (path) => {
    const listModels = vi.fn(async () => {
      throw new Error("catalog offline")
    })
    const { baseUrl } = await start(backend(listModels))

    const response = await fetch(`${baseUrl}${path}`)

    expect(response.status).toBe(502)
    expect(await response.json()).toEqual({
      error: {
        message: "Could not read the model catalog: catalog offline",
        type: "CatalogError"
      }
    })
  })
})
