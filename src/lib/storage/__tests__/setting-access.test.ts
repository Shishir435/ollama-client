import { beforeEach, describe, expect, it, vi } from "vitest"

import { STORAGE_KEYS } from "@/lib/constants"

const storage = vi.hoisted(() => ({
  get: vi.fn(),
  set: vi.fn(),
  remove: vi.fn()
}))

vi.mock("@/lib/plasmo-global-storage", () => ({
  getPlasmoStoredValue: storage.get,
  setPlasmoStoredValue: storage.set,
  removePlasmoStoredValue: storage.remove
}))

import {
  readSetting,
  readStoredSetting,
  removeSetting,
  writeSetting
} from "../setting-access"
import { defineSetting } from "../setting-descriptor"

/** Trims and rejects blanks, so parse is observable in both directions. */
const trimmedString = {
  safeParse: (value: unknown) =>
    typeof value === "string" && value.trim()
      ? ({ success: true, data: value.trim() } as const)
      : ({ success: false, error: "not a non-empty string" } as const)
}

const SYNC_KEY = STORAGE_KEYS.LANGUAGE
const DEVICE_KEY = STORAGE_KEYS.PROVIDER.SECRETS

beforeEach(() => {
  vi.clearAllMocks()
  storage.set.mockResolvedValue(undefined)
  storage.remove.mockResolvedValue(undefined)
  storage.get.mockResolvedValue(undefined)
})

describe("defineSetting", () => {
  it("refuses a key that is not in the storage registry", () => {
    // The registry is what decides sync vs device-local. A key that skipped it
    // would get a scope by accident — which for a credential is the difference
    // between local-only and synced to every profile.
    expect(() => defineSetting("totally-made-up-key")).toThrow(
      /Unregistered storage key/
    )
  })

  it("takes scope from the registry, never from the caller", () => {
    expect(defineSetting(SYNC_KEY, { defaultValue: "" }).scope).toBe(
      "sync-safe"
    )
    expect(defineSetting(DEVICE_KEY, { defaultValue: {} }).scope).toBe(
      "device-local"
    )
    // TTS voice URIs identify a voice installed on this machine, so the
    // registry marks them device-local and the descriptor inherits that
    // without the settings module restating it.
    expect(
      defineSetting(STORAGE_KEYS.TTS.VOICE_URI, { defaultValue: "" }).scope
    ).toBe("device-local")
  })
})

describe("readSetting", () => {
  it("falls back to the default when nothing is stored", async () => {
    const descriptor = defineSetting<string>(SYNC_KEY, { defaultValue: "alex" })

    storage.get.mockResolvedValue(undefined)
    await expect(readSetting(descriptor)).resolves.toBe("alex")
    storage.get.mockResolvedValue(null)
    await expect(readSetting(descriptor)).resolves.toBe("alex")
  })

  it("falls back to the default when stored data no longer parses", async () => {
    // Corrupt or outdated values must degrade to the default rather than
    // propagate — this runs on the read path of every settings screen.
    const descriptor = defineSetting<string>(SYNC_KEY, {
      defaultValue: "alex",
      parser: trimmedString
    })
    storage.get.mockResolvedValue({ unexpected: "shape" })

    await expect(readSetting(descriptor)).resolves.toBe("alex")
  })

  it("returns the parsed value, not the raw one", async () => {
    const descriptor = defineSetting<string>(SYNC_KEY, {
      defaultValue: "alex",
      parser: trimmedString
    })
    storage.get.mockResolvedValue("  spaced  ")

    await expect(readSetting(descriptor)).resolves.toBe("spaced")
  })

  it("passes the stored value through when there is no parser", async () => {
    const descriptor = defineSetting<string>(SYNC_KEY, { defaultValue: "alex" })
    storage.get.mockResolvedValue("  spaced  ")

    await expect(readSetting(descriptor)).resolves.toBe("  spaced  ")
  })
})

describe("readStoredSetting", () => {
  it("preserves absence for compatibility migrations", async () => {
    const descriptor = defineSetting<string>(SYNC_KEY, {
      defaultValue: "default"
    })

    storage.get.mockResolvedValue(undefined)
    await expect(readStoredSetting(descriptor)).resolves.toBeUndefined()
  })

  it("validates stored data without substituting the default", async () => {
    const descriptor = defineSetting<string>(SYNC_KEY, {
      defaultValue: "default",
      parser: trimmedString
    })

    storage.get.mockResolvedValue({ bad: true })
    await expect(readStoredSetting(descriptor)).resolves.toBeUndefined()
    storage.get.mockResolvedValue("  stored  ")
    await expect(readStoredSetting(descriptor)).resolves.toBe("stored")
  })
})

describe("writeSetting", () => {
  it("rejects an invalid value instead of persisting it", async () => {
    const descriptor = defineSetting<string>(SYNC_KEY, {
      defaultValue: "alex",
      parser: trimmedString
    })

    await expect(writeSetting(descriptor, "   ")).rejects.toThrow(
      /Invalid value for setting/
    )
    expect(storage.set).not.toHaveBeenCalled()
  })

  it("persists the parsed value so storage holds the normalized form", async () => {
    const descriptor = defineSetting<string>(SYNC_KEY, {
      defaultValue: "alex",
      parser: trimmedString
    })

    await writeSetting(descriptor, "  spaced  ")

    expect(storage.set).toHaveBeenCalledWith(SYNC_KEY, "spaced")
  })

  it("writes through the scope-aware setter, not a raw area handle", async () => {
    const descriptor = defineSetting<Record<string, string>>(DEVICE_KEY, {
      defaultValue: {}
    })

    await writeSetting(descriptor, { openai: "sk-secret" })

    expect(storage.set).toHaveBeenCalledWith(DEVICE_KEY, {
      openai: "sk-secret"
    })
  })
})

describe("removeSetting", () => {
  it("delegates to the scope-aware remover", async () => {
    await removeSetting(defineSetting<string>(SYNC_KEY, { defaultValue: "" }))

    expect(storage.remove).toHaveBeenCalledWith(SYNC_KEY)
  })
})
