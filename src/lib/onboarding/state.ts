import { z } from "zod"

import { STORAGE_KEYS } from "@/lib/constants"
import {
  getPlasmoStoredValue,
  setPlasmoStoredValue
} from "@/lib/plasmo-global-storage"
import { withStorageWriteLock } from "@/lib/storage/storage-write-lock"
import type { SelectedModelRef } from "@/types/model"

export const OnboardingStageSchema = z.enum([
  "privacy",
  "provider-choice",
  "provider-connection",
  "model-choice",
  "test-chat",
  "complete"
])

export type OnboardingStage = z.infer<typeof OnboardingStageSchema>

export const OnboardingStateSchema = z
  .object({
    version: z.literal(2),
    stage: OnboardingStageSchema,
    providerId: z.string().min(1).max(200).optional(),
    modelRef: z
      .object({
        providerId: z.string().min(1).max(200),
        modelId: z.string().min(1).max(500)
      })
      .strict()
      .optional(),
    testSessionId: z.string().uuid().optional(),
    completedAt: z.number().int().nonnegative().optional(),
    skippedAt: z.number().int().nonnegative().optional()
  })
  .strict()

export type OnboardingState = z.infer<typeof OnboardingStateSchema>

export const INITIAL_ONBOARDING_STATE: OnboardingState = {
  version: 2,
  stage: "privacy"
}

const ONBOARDING_LOCK = "onboarding-state-v2-write"

const readStoredState = async (): Promise<OnboardingState | undefined> => {
  const raw = await getPlasmoStoredValue<unknown>(STORAGE_KEYS.ONBOARDING.STATE)
  const parsed = OnboardingStateSchema.safeParse(raw)
  return parsed.success ? parsed.data : undefined
}

/**
 * Read resumable onboarding state. Profiles that completed the legacy intro
 * are treated as complete so an upgrade never forces established users back
 * through first-run setup.
 */
export const getOnboardingState = async (): Promise<OnboardingState> => {
  const current = await readStoredState()
  if (current) return current

  const legacySeen = await getPlasmoStoredValue<boolean>(
    STORAGE_KEYS.ONBOARDING_PERMISSIONS_SEEN
  )
  const migrated: OnboardingState = legacySeen
    ? { version: 2, stage: "complete", completedAt: Date.now() }
    : INITIAL_ONBOARDING_STATE
  await setPlasmoStoredValue(STORAGE_KEYS.ONBOARDING.STATE, migrated)
  return migrated
}

export const updateOnboardingState = async (
  update: Partial<Omit<OnboardingState, "version">>
): Promise<OnboardingState> =>
  withStorageWriteLock(ONBOARDING_LOCK, async () => {
    const current = await getOnboardingState()
    if (current.stage === "complete") return current
    const next = OnboardingStateSchema.parse({
      ...current,
      ...update,
      version: 2
    })
    await setPlasmoStoredValue(STORAGE_KEYS.ONBOARDING.STATE, next)
    return next
  })

export const selectOnboardingProvider = (providerId: string) =>
  updateOnboardingState({
    stage: "provider-connection",
    providerId,
    modelRef: undefined
  })

export const selectOnboardingModel = (modelRef: SelectedModelRef) =>
  updateOnboardingState({
    stage: "test-chat",
    providerId: modelRef.providerId,
    modelRef,
    testSessionId: undefined
  })

/** Called only after a final assistant message has been durably written. */
export const completeOnboardingAfterFirstResponse = async (
  sessionId: string | null
): Promise<boolean> =>
  withStorageWriteLock(ONBOARDING_LOCK, async () => {
    const current = await getOnboardingState()
    if (
      current.stage !== "test-chat" ||
      !sessionId ||
      current.testSessionId !== sessionId
    ) {
      return false
    }
    await setPlasmoStoredValue(STORAGE_KEYS.ONBOARDING.STATE, {
      ...current,
      stage: "complete",
      completedAt: Date.now()
    } satisfies OnboardingState)
    return true
  })

export const skipOnboarding = () =>
  updateOnboardingState({ stage: "complete", skippedAt: Date.now() })
