import { describe, expect, it } from "vitest"
import { STORAGE_KEYS } from "@/lib/constants"
import {
  getStorageKeyMetadata,
  STORAGE_KEY_REGISTRY
} from "../storage-key-registry"

const flattenKeys = (value: unknown): string[] => {
  if (typeof value === "string") return [value]
  if (!value || typeof value !== "object") return []
  return Object.values(value).flatMap(flattenKeys)
}

describe("storage key registry", () => {
  it("classifies every storage key as sync-safe or device-local", () => {
    const storageKeys = flattenKeys(STORAGE_KEYS)

    expect(Object.keys(STORAGE_KEY_REGISTRY).sort()).toEqual(storageKeys.sort())
    expect(
      Object.values(STORAGE_KEY_REGISTRY).every(
        (entry) => entry.scope === "sync-safe" || entry.scope === "device-local"
      )
    ).toBe(true)
  })

  it("marks local durability and handoff flags as device-local", () => {
    expect(
      getStorageKeyMetadata(STORAGE_KEYS.BROWSER.PENDING_SELECTION_TEXT)
    ).toMatchObject({ scope: "device-local" })
    expect(
      getStorageKeyMetadata(STORAGE_KEYS.BROWSER.PENDING_OMNIBOX_QUERY)
    ).toMatchObject({ scope: "device-local" })
    expect(
      getStorageKeyMetadata(STORAGE_KEYS.BROWSER.PER_SITE_PROFILES)
    ).toMatchObject({ scope: "sync-safe" })
    expect(
      getStorageKeyMetadata(STORAGE_KEYS.EMBEDDINGS.KEYWORD_INDEX_BUILT)
    ).toMatchObject({ scope: "device-local" })
    expect(
      getStorageKeyMetadata(STORAGE_KEYS.BACKGROUND.SCHEDULED_JOBS)
    ).toMatchObject({ scope: "device-local" })
    expect(
      getStorageKeyMetadata(STORAGE_KEYS.BACKGROUND.REMINDERS)
    ).toMatchObject({
      scope: "device-local"
    })
  })
})
