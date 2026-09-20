import { createServer, type Server } from "node:http"
import type { AddressInfo } from "node:net"
import { afterEach, describe, expect, it, vi } from "vitest"

import { createOpencodeBackend } from "../index.js"

/**
 * The catalog is cached for thirty seconds, and a backend that is up has not
 * necessarily finished discovering its providers. Caching the empty answer it
 * gives in the meantime turned one unlucky read into half a minute of a proxy
 * reporting that its runtime has no models — which the extension's model menu
 * shows as a provider that lists nothing, and which nothing retried, because a
 * missing catalog is a normal answer rather than a failure.
 */
describe("OpenCode catalog cache", () => {
  let server: Server | null = null

  afterEach(async () => {
    if (server)
      await new Promise<void>((resolve) => server?.close(() => resolve()))
    server = null
  })

  const backendAgainst = async (
    providersFor: () => unknown
  ): Promise<{
    backend: ReturnType<typeof createOpencodeBackend>
    asked: () => number
  }> => {
    let asked = 0
    server = createServer((request, response) => {
      response.writeHead(200, { "content-type": "application/json" })
      if (request.url?.startsWith("/config/providers")) {
        asked += 1
        response.end(JSON.stringify({ providers: providersFor() }))
        return
      }
      /* Not the v2 catalog shape, so the legacy provider list answers. */
      response.end(JSON.stringify({}))
    })
    await new Promise<void>((resolve) =>
      server?.listen(0, "127.0.0.1", resolve)
    )
    const { port } = server.address() as AddressInfo
    return {
      backend: createOpencodeBackend({
        config: {
          PORT: 9999,
          BRIDGE_ENDPOINT: "http://bridge",
          BRIDGE_TOKEN: "t"
        },
        log: vi.fn(),
        retryAsync: (run: () => unknown) => run(),
        options: { OPENCODE_SERVER_URL: `http://127.0.0.1:${port}` },
        fileOptions: {}
      } as never),
      asked: () => asked
    }
  }

  it("asks again after an empty catalog instead of serving it from memory", async () => {
    let providers: unknown = []
    const { backend, asked } = await backendAgainst(() => providers)

    expect(await backend.listModels()).toEqual([])
    providers = [{ id: "opencode", models: { "muse-spark": { name: "Muse" } } }]
    const second = await backend.listModels()

    expect(asked()).toBe(2)
    expect(second.map((model) => model.id)).toEqual(["opencode/muse-spark"])
  })

  it("serves a catalog it actually has from memory", async () => {
    const providers = [
      { id: "opencode", models: { "muse-spark": { name: "Muse" } } }
    ]
    const { backend, asked } = await backendAgainst(() => providers)

    const first = await backend.listModels()
    const second = await backend.listModels()

    expect(asked()).toBe(1)
    expect(second).toEqual(first)
  })
})
