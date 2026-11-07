import { beforeEach, describe, expect, it, vi } from "vitest"
import {
  getPlasmoStoredValue,
  setPlasmoStoredValue
} from "@/lib/plasmo-global-storage"
import { SETTINGS } from "@/lib/storage/settings"
import { toggleCloudModels } from "../cloud-models"

let enabled = false

beforeEach(() => {
  enabled = false
  vi.mocked(getPlasmoStoredValue).mockImplementation(
    async <T>() => enabled as T
  )
  vi.mocked(setPlasmoStoredValue).mockImplementation(async (_key, next) => {
    enabled = next === true
  })
})

describe("background cloud model toggles", () => {
  it("serializes saves from separate pickers without waiting for any catalog", async () => {
    let finishSave!: () => void
    const pendingSave = new Promise<void>((resolve) => {
      finishSave = resolve
    })
    vi.mocked(setPlasmoStoredValue).mockImplementationOnce(
      async (_key, next) => {
        await pendingSave
        enabled = next === true
      }
    )
    const requests = [
      toggleCloudModels(new AbortController().signal),
      toggleCloudModels(new AbortController().signal),
      toggleCloudModels(new AbortController().signal)
    ]
    await vi.waitFor(() =>
      expect(setPlasmoStoredValue).toHaveBeenCalledTimes(1)
    )
    finishSave()
    await expect(Promise.all(requests)).resolves.toEqual([
      { enabled: true },
      { enabled: false },
      { enabled: true }
    ])
    expect(vi.mocked(setPlasmoStoredValue).mock.calls).toEqual([
      [SETTINGS.OLLAMA_CLOUD_MODELS.key, true],
      [SETTINGS.OLLAMA_CLOUD_MODELS.key, false],
      [SETTINGS.OLLAMA_CLOUD_MODELS.key, true]
    ])
    expect(enabled).toBe(true)
  })

  it("continues after a failed save using the actual stored setting", async () => {
    vi.mocked(setPlasmoStoredValue).mockRejectedValueOnce(
      new Error("Save failed")
    )
    const results = await Promise.allSettled([
      toggleCloudModels(new AbortController().signal),
      toggleCloudModels(new AbortController().signal)
    ])
    expect(results[0].status).toBe("rejected")
    expect(results[1]).toEqual({
      status: "fulfilled",
      value: { enabled: true }
    })
    expect(enabled).toBe(true)
  })

  it("does not execute a queued toggle after its caller cancels", async () => {
    let finishRead!: (value: boolean) => void
    vi.mocked(getPlasmoStoredValue).mockReturnValueOnce(
      new Promise((resolve) => {
        finishRead = resolve
      })
    )
    const controller = new AbortController()
    const first = toggleCloudModels(new AbortController().signal)
    const second = toggleCloudModels(controller.signal)
    const results = Promise.allSettled([first, second])
    await vi.waitFor(() =>
      expect(getPlasmoStoredValue).toHaveBeenCalledTimes(1)
    )
    controller.abort()
    finishRead(false)
    expect((await results)[1].status).toBe("rejected")
    expect(setPlasmoStoredValue).toHaveBeenCalledTimes(1)
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
  })
})
