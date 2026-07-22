import { beforeEach, describe, expect, it, vi } from "vitest"

import { STORAGE_KEYS } from "@/lib/constants"
import {
  completeOnboardingAfterFirstResponse,
  getOnboardingState,
  selectOnboardingModel,
  updateOnboardingState
} from "../state"

const storage = vi.hoisted(() => ({
  get: vi.fn(),
  set: vi.fn()
}))

vi.mock("@/lib/plasmo-global-storage", () => ({
  getPlasmoStoredValue: storage.get,
  setPlasmoStoredValue: storage.set
}))

beforeEach(() => {
  storage.get.mockReset()
  storage.set.mockReset().mockResolvedValue(undefined)
})

describe("onboarding state", () => {
  it("migrates the legacy seen flag to complete", async () => {
    storage.get.mockImplementation(async (key: string) =>
      key === STORAGE_KEYS.ONBOARDING_PERMISSIONS_SEEN ? true : undefined
    )

    await expect(getOnboardingState()).resolves.toMatchObject({
      version: 2,
      stage: "complete"
    })
  })

  it("starts new profiles at privacy", async () => {
    storage.get.mockResolvedValue(undefined)
    await expect(getOnboardingState()).resolves.toEqual({
      version: 2,
      stage: "privacy"
    })
  })

  it("completes only from test-chat", async () => {
    storage.get.mockResolvedValue({ version: 2, stage: "privacy" })
    await expect(completeOnboardingAfterFirstResponse()).resolves.toBe(false)

    storage.get.mockResolvedValue({
      version: 2,
      stage: "test-chat",
      providerId: "ollama",
      modelRef: { providerId: "ollama", modelId: "qwen3" }
    })
    await expect(completeOnboardingAfterFirstResponse()).resolves.toBe(true)
    expect(storage.set).toHaveBeenLastCalledWith(
      STORAGE_KEYS.ONBOARDING.STATE,
      expect.objectContaining({ stage: "complete" })
    )
  })

  it("persists provider-qualified model selection", async () => {
    storage.get.mockResolvedValue({
      version: 2,
      stage: "model-choice",
      providerId: "openrouter",
      testSessionId: "22222222-2222-4222-8222-222222222222"
    })
    await selectOnboardingModel({
      providerId: "openrouter",
      modelId: "vendor/model"
    })
    expect(storage.set).toHaveBeenCalledWith(
      STORAGE_KEYS.ONBOARDING.STATE,
      expect.objectContaining({
        stage: "test-chat",
        modelRef: { providerId: "openrouter", modelId: "vendor/model" },
        testSessionId: undefined
      })
    )
  })

  it("does not reopen completed onboarding", async () => {
    storage.get.mockResolvedValue({
      version: 2,
      stage: "complete",
      completedAt: 1
    })
    await expect(
      updateOnboardingState({ stage: "provider-choice" })
    ).resolves.toMatchObject({ stage: "complete" })
  })
})
