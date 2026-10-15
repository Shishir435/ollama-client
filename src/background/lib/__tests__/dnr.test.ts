import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  providers: vi.fn(),
  apply: vi.fn(),
  clear: vi.fn(),
  chromium: vi.fn(),
  ffSupported: vi.fn(),
  ffSet: vi.fn(),
  ffClear: vi.fn()
}))

vi.mock("@/lib/providers/manager", () => ({
  ProviderManager: { getProviders: mocks.providers }
}))
vi.mock("@/lib/browser-api", () => ({ isChromiumBased: mocks.chromium }))
vi.mock("@/lib/firefox-origin-guard", () => ({
  supportsOriginStripListener: mocks.ffSupported,
  setStrippedProviderOrigins: mocks.ffSet,
  clearStrippedProviderOrigins: mocks.ffClear
}))
vi.mock("@/lib/dnr-rules", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/dnr-rules")>()),
  applyProviderOriginRules: mocks.apply,
  clearProviderOriginRules: mocks.clear
}))

import { updateDNRRules } from "../dnr"

beforeEach(() => {
  vi.clearAllMocks()
  mocks.chromium.mockReturnValue(true)
  mocks.apply.mockResolvedValue(undefined)
  mocks.clear.mockResolvedValue(undefined)
})

describe("updateDNRRules", () => {
  it("covers every configured provider endpoint, not only Ollama", async () => {
    mocks.providers.mockResolvedValue([
      { id: "ollama", enabled: true },
      { id: "lm studio", enabled: false },
      {
        id: "custom:my-llm",
        enabled: true,
        baseUrl: "https://llm.example.com/v1"
      },
      { id: "custom:broken", enabled: true }
    ])

    await updateDNRRules()

    expect(mocks.apply).toHaveBeenCalledWith([
      "http://localhost:11434",
      "http://localhost:1234",
      "https://llm.example.com"
    ])
  })

  it("hands Firefox the same provider set through its listener", async () => {
    mocks.chromium.mockReturnValue(false)
    mocks.ffSupported.mockReturnValue(true)
    mocks.providers.mockResolvedValue([
      { id: "ollama", enabled: true },
      {
        id: "custom:my-llm",
        enabled: true,
        baseUrl: "https://llm.example.com/v1"
      }
    ])

    await updateDNRRules()

    expect(mocks.apply).not.toHaveBeenCalled()
    expect(mocks.ffSet).toHaveBeenCalledWith([
      "http://localhost:11434",
      "https://llm.example.com/v1"
    ])
  })

  it("strips nothing on Firefox when the reconcile fails", async () => {
    mocks.chromium.mockReturnValue(false)
    mocks.ffSupported.mockReturnValue(true)
    mocks.providers.mockRejectedValue(new Error("storage locked"))

    await updateDNRRules()

    expect(mocks.ffSet).not.toHaveBeenCalled()
    expect(mocks.ffClear).toHaveBeenCalledTimes(1)
  })

  it("installs nothing where the browser has neither DNR nor the listener", async () => {
    mocks.chromium.mockReturnValue(false)
    mocks.ffSupported.mockReturnValue(false)

    await updateDNRRules()

    expect(mocks.providers).not.toHaveBeenCalled()
    expect(mocks.apply).not.toHaveBeenCalled()
    expect(mocks.ffSet).not.toHaveBeenCalled()
  })

  it("removes every installed rule when the reconcile fails", async () => {
    mocks.providers.mockRejectedValue(new Error("storage locked"))

    await expect(updateDNRRules()).resolves.toBeUndefined()

    expect(mocks.apply).not.toHaveBeenCalled()
    expect(mocks.clear).toHaveBeenCalledTimes(1)
  })

  it("clears the rules when applying the new set is refused", async () => {
    mocks.providers.mockResolvedValue([{ id: "ollama", enabled: true }])
    mocks.apply.mockRejectedValue(new Error("quota"))

    await updateDNRRules()

    expect(mocks.clear).toHaveBeenCalledTimes(1)
  })

  it("does not clear the rules after a successful reconcile", async () => {
    mocks.providers.mockResolvedValue([{ id: "ollama", enabled: true }])

    await updateDNRRules()

    expect(mocks.clear).not.toHaveBeenCalled()
  })

  it("applies overlapping reconciles in the order they were asked for", async () => {
    let releaseOld: (value: unknown) => void = () => undefined
    mocks.providers
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            releaseOld = () => resolve([{ id: "ollama", enabled: true }])
          })
      )
      .mockResolvedValueOnce([
        { id: "custom:new", enabled: true, baseUrl: "https://new.example/v1" }
      ])

    const first = updateDNRRules()
    const second = updateDNRRules()
    await new Promise((resolve) => setTimeout(resolve, 0))
    releaseOld(undefined)
    await Promise.all([first, second])

    expect(mocks.apply.mock.calls).toEqual([
      [["http://localhost:11434"]],
      [["https://new.example"]]
    ])
  })

  it("applies overlapping Firefox reconciles in order", async () => {
    mocks.chromium.mockReturnValue(false)
    mocks.ffSupported.mockReturnValue(true)
    let releaseOld: (value: unknown) => void = () => undefined
    mocks.providers
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            releaseOld = () => resolve([{ id: "ollama", enabled: true }])
          })
      )
      .mockResolvedValueOnce([
        { id: "custom:new", enabled: true, baseUrl: "https://new.example/v1" }
      ])

    const first = updateDNRRules()
    const second = updateDNRRules()
    await new Promise((resolve) => setTimeout(resolve, 0))
    releaseOld(undefined)
    await Promise.all([first, second])

    expect(mocks.ffSet.mock.calls.at(-1)).toEqual([["https://new.example/v1"]])
  })
})
