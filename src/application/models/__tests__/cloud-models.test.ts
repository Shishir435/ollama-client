import type { ProvidersListModelsResult } from "@ollama-client/contracts/provider-rpc"
import { beforeEach, describe, expect, it, vi } from "vitest"
import {
  getPlasmoStoredValue,
  setPlasmoStoredValue
} from "@/lib/plasmo-global-storage"
import { ProviderRpcService } from "@/lib/providers/provider-rpc-service"
import { SETTINGS } from "@/lib/storage/settings"
import { toggleCloudModels } from "../cloud-models"

vi.mock("@/lib/providers/provider-rpc-service", () => ({
  ProviderRpcService: { listModels: vi.fn() }
}))

const catalog: ProvidersListModelsResult = { models: [], failures: [] }
let enabled = false

beforeEach(() => {
  enabled = false
  vi.mocked(getPlasmoStoredValue).mockImplementation(
    async <T>() => enabled as T
  )
  vi.mocked(setPlasmoStoredValue).mockImplementation(async (_key, next) => {
    enabled = next === true
  })
  vi.mocked(ProviderRpcService.listModels).mockResolvedValue(catalog)
})

describe("background cloud model toggles", () => {
  it("serializes requests from separate pickers through each catalog refresh", async () => {
    let finishRefresh!: (result: ProvidersListModelsResult) => void
    const pendingRefresh = new Promise<ProvidersListModelsResult>((resolve) => {
      finishRefresh = resolve
    })
    vi.mocked(ProviderRpcService.listModels).mockReturnValueOnce(pendingRefresh)
    const firstSignal = new AbortController().signal
    const secondSignal = new AbortController().signal
    const first = toggleCloudModels(firstSignal)
    const second = toggleCloudModels(secondSignal)

    await vi.waitFor(() =>
      expect(ProviderRpcService.listModels).toHaveBeenCalledTimes(1)
    )
    expect(enabled).toBe(true)
    expect(setPlasmoStoredValue).toHaveBeenCalledTimes(1)
    finishRefresh(catalog)
    await expect(Promise.all([first, second])).resolves.toEqual([
      catalog,
      catalog
    ])

    expect(setPlasmoStoredValue).toHaveBeenNthCalledWith(
      1,
      SETTINGS.OLLAMA_CLOUD_MODELS.key,
      true
    )
    expect(setPlasmoStoredValue).toHaveBeenNthCalledWith(
      2,
      SETTINGS.OLLAMA_CLOUD_MODELS.key,
      false
    )
    expect(ProviderRpcService.listModels).toHaveBeenNthCalledWith(
      1,
      { providerId: "ollama" },
      firstSignal
    )
    expect(ProviderRpcService.listModels).toHaveBeenNthCalledWith(
      2,
      { providerId: "ollama" },
      secondSignal
    )
    expect(enabled).toBe(false)
  })

  it("continues after a failed refresh using the setting that was saved", async () => {
    vi.mocked(ProviderRpcService.listModels).mockRejectedValueOnce(
      new Error("Offline")
    )
    const results = await Promise.allSettled([
      toggleCloudModels(new AbortController().signal),
      toggleCloudModels(new AbortController().signal)
    ])
    expect(results[0].status).toBe("rejected")
    expect(results[1]).toEqual({ status: "fulfilled", value: catalog })
    expect(enabled).toBe(false)
  })

  it("does not execute a queued toggle after its caller cancels", async () => {
    let finishRefresh!: (result: ProvidersListModelsResult) => void
    const pendingRefresh = new Promise<ProvidersListModelsResult>((resolve) => {
      finishRefresh = resolve
    })
    vi.mocked(ProviderRpcService.listModels).mockReturnValueOnce(pendingRefresh)
    const controller = new AbortController()
    const first = toggleCloudModels(new AbortController().signal)
    const second = toggleCloudModels(controller.signal)
    const results = Promise.allSettled([first, second])
    await vi.waitFor(() => expect(enabled).toBe(true))
    controller.abort()
    finishRefresh(catalog)
    expect((await results)[1].status).toBe("rejected")
    expect(setPlasmoStoredValue).toHaveBeenCalledTimes(1)
    expect(ProviderRpcService.listModels).toHaveBeenCalledTimes(1)
    expect(enabled).toBe(true)
  })

  it("checks cancellation again after reading and before saving", async () => {
    let finishRead!: (value: boolean) => void
    vi.mocked(getPlasmoStoredValue).mockReturnValueOnce(
      new Promise((resolve) => {
        finishRead = resolve
      })
    )
    const controller = new AbortController()
    const request = toggleCloudModels(controller.signal)
    const rejected = expect(request).rejects.toMatchObject({
      name: "AbortError"
    })
    await vi.waitFor(() =>
      expect(getPlasmoStoredValue).toHaveBeenCalledTimes(1)
    )
    controller.abort()
    finishRead(false)
    await rejected
    expect(setPlasmoStoredValue).not.toHaveBeenCalled()
    expect(ProviderRpcService.listModels).not.toHaveBeenCalled()
  })
})
