import { beforeEach, describe, expect, it, vi } from "vitest"

const storageBacking = vi.hoisted(() => new Map<string, unknown>())

vi.mock("@/lib/plasmo-global-storage", () => ({
  getPlasmoStoredValue: vi.fn(async (key: string) => storageBacking.get(key)),
  setPlasmoStoredValue: vi.fn(async (key: string, value: unknown) => {
    storageBacking.set(key, value)
  })
}))

import { createAppError } from "@/lib/error-utils"
import type { ProviderModel } from "@/types/model"
import { getModelCatalogSupport } from "../model-catalog-support"
import { discoverModels, discoverProviderModels } from "../model-discovery"
import type { LLMProvider, ProviderConfig } from "../types"
import { ProviderType } from "../types"

const config: ProviderConfig = {
  id: "custom:openai:router",
  type: ProviderType.OPENAI,
  name: "Router",
  enabled: true,
  baseUrl: "https://api.example.test/v1"
}

const model = (name: string): ProviderModel =>
  ({ name, model: name }) as ProviderModel

const providerWith = (getModels: LLMProvider["getModels"]) =>
  ({ config, getModels }) as unknown as LLMProvider

beforeEach(() => {
  storageBacking.clear()
})

describe("model discovery policy", () => {
  it("returns the catalog and remembers that one exists", async () => {
    const getModels = vi.fn().mockResolvedValue([model("gpt-4o")])

    await expect(
      discoverModels(config, async () => ({ getModels }))
    ).resolves.toEqual({ models: [model("gpt-4o")], catalog: "present" })
    await expect(getModelCatalogSupport(config)).resolves.toBe(true)
  })

  it("records absence only for a missing endpoint", async () => {
    for (const status of [404, 405, 501]) {
      storageBacking.clear()
      const getModels = vi
        .fn()
        .mockRejectedValue(createAppError("nope", { status }))

      const result = await discoverModels(config, async () => ({ getModels }))
      expect(result).toEqual({ models: [], catalog: "absent" })
      await expect(getModelCatalogSupport(config)).resolves.toBe(false)
    }
  })

  it("never records a refusal, a rate limit, or a server error", async () => {
    // None of these says anything about whether the endpoint exists, and
    // remembering one would silence a provider that is merely misconfigured.
    for (const status of [401, 403, 429, 500, 503]) {
      storageBacking.clear()
      const error = createAppError("no", { status })
      const getModels = vi.fn().mockRejectedValue(error)

      const result = await discoverModels(config, async () => ({ getModels }))
      expect(result).toEqual({ models: [], catalog: "failed", error })
      await expect(getModelCatalogSupport(config)).resolves.toBeNull()
    }
  })

  it("treats a transport failure with no status as a failure", async () => {
    const error = new TypeError("Failed to fetch")
    const getModels = vi.fn().mockRejectedValue(error)

    await expect(
      discoverModels(config, async () => ({ getModels }))
    ).resolves.toEqual({ models: [], catalog: "failed", error })
    await expect(getModelCatalogSupport(config)).resolves.toBeNull()
  })

  it("does not ask a provider that already answered it has no catalog", async () => {
    const absent = vi
      .fn()
      .mockRejectedValue(createAppError("nope", { status: 404 }))
    await discoverModels(config, async () => ({ getModels: absent }))
    expect(absent).toHaveBeenCalledTimes(1)

    const second = vi.fn()
    await expect(
      discoverModels(config, async () => ({ getModels: second }))
    ).resolves.toEqual({ models: [], catalog: "absent" })
    // The whole point: no second request, and no provider resolution either.
    expect(second).not.toHaveBeenCalled()
  })

  it("re-probes and updates the remembered answer when forced", async () => {
    await discoverModels(config, async () => ({
      getModels: vi
        .fn()
        .mockRejectedValue(createAppError("nope", { status: 404 }))
    }))
    await expect(getModelCatalogSupport(config)).resolves.toBe(false)

    const getModels = vi.fn().mockResolvedValue([model("gpt-4o")])
    await expect(
      discoverModels(config, async () => ({ getModels }), undefined, {
        force: true
      })
    ).resolves.toEqual({ models: [model("gpt-4o")], catalog: "present" })
    expect(getModels).toHaveBeenCalledTimes(1)
    // A server that gained the endpoint stops being skipped.
    await expect(getModelCatalogSupport(config)).resolves.toBe(true)
  })

  it("stops applying a remembered answer once the endpoint changes", async () => {
    await discoverModels(config, async () => ({
      getModels: vi
        .fn()
        .mockRejectedValue(createAppError("nope", { status: 404 }))
    }))

    const moved: ProviderConfig = {
      ...config,
      baseUrl: "https://other.example.test/v1"
    }
    const getModels = vi.fn().mockResolvedValue([model("llama")])
    await expect(
      discoverModels(moved, async () => ({ getModels }))
    ).resolves.toEqual({ models: [model("llama")], catalog: "present" })
    expect(getModels).toHaveBeenCalledTimes(1)
  })

  it("rethrows when the caller aborted rather than blaming the endpoint", async () => {
    const controller = new AbortController()
    controller.abort()
    const error = new DOMException("Aborted", "AbortError")
    const getModels = vi.fn().mockRejectedValue(error)

    await expect(
      discoverModels(config, async () => ({ getModels }), controller.signal)
    ).rejects.toBe(error)
    // An abort is the caller's decision; recording it would teach the wrong
    // lesson about a provider that was never given a chance to answer.
    await expect(getModelCatalogSupport(config)).resolves.toBeNull()
  })

  it("asks a provider with no stored config every time", async () => {
    const getModels = vi.fn().mockResolvedValue([])
    await discoverModels(undefined, async () => ({ getModels }))
    await discoverModels(undefined, async () => ({ getModels }))
    expect(getModels).toHaveBeenCalledTimes(2)
  })

  it("keys a resolved provider's answer on the config it carries", async () => {
    const getModels = vi
      .fn()
      .mockRejectedValue(createAppError("nope", { status: 404 }))

    await expect(
      discoverProviderModels(providerWith(getModels))
    ).resolves.toEqual({ models: [], catalog: "absent" })
    await expect(getModelCatalogSupport(config)).resolves.toBe(false)

    await discoverProviderModels(providerWith(getModels))
    expect(getModels).toHaveBeenCalledTimes(1)
  })
})
