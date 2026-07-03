import { afterEach, describe, expect, it, vi } from "vitest"

import { ProviderType } from "@/lib/providers/types"
import { checkProviderConnection } from "../provider-connection"

const config = {
  id: "ollama",
  type: ProviderType.OLLAMA,
  enabled: true,
  name: "Ollama",
  baseUrl: "http://localhost:11434"
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("checkProviderConnection", () => {
  it("reports a connected Ollama endpoint and model count", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ models: [{ name: "qwen" }] }), {
        status: 200
      })
    )
    vi.stubGlobal("fetch", fetchMock)

    await expect(checkProviderConnection(config)).resolves.toEqual({
      kind: "connected",
      modelCount: 1
    })
    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:11434/api/tags",
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    )
  })

  it("classifies a local forbidden response as CORS", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("", { status: 403 }))
    )

    await expect(checkProviderConnection(config)).resolves.toEqual({
      kind: "cors",
      status: 403
    })
  })

  it("keeps opaque network failures honest", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("fetch")))

    await expect(checkProviderConnection(config)).resolves.toEqual({
      kind: "unavailable"
    })
  })
})
