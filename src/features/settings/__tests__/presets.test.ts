import { describe, expect, it } from "vitest"
import { STORAGE_KEYS } from "@/lib/constants"
import { getPreset, SETTINGS_PRESETS } from "../presets"

const flattenKeys = (obj: object): string[] =>
  Object.values(obj).flatMap((v) =>
    typeof v === "string" ? [v] : flattenKeys(v as object)
  )
const VALID_STORAGE_KEYS = new Set(flattenKeys(STORAGE_KEYS))

describe("settings presets", () => {
  it("defines the four expected presets", () => {
    expect(SETTINGS_PRESETS.map((p) => p.id)).toEqual([
      "fast",
      "balanced",
      "large-context",
      "privacy-strict"
    ])
  })

  it("every preset write targets a real storage key", () => {
    for (const preset of SETTINGS_PRESETS) {
      for (const write of preset.writes) {
        expect(
          VALID_STORAGE_KEYS.has(write.storageKey),
          `${preset.id}: ${write.storageKey}`
        ).toBe(true)
      }
    }
  })

  it("every preset has at least one write", () => {
    for (const preset of SETTINGS_PRESETS) {
      expect(preset.writes.length, preset.id).toBeGreaterThan(0)
    }
  })

  it("balanced is sourced from section defaults (has field writes)", () => {
    const balanced = getPreset("balanced")
    expect(balanced?.writes.some((w) => w.field)).toBe(true)
  })

  it("privacy-strict turns page access off and grounding on", () => {
    const writes = getPreset("privacy-strict")?.writes ?? []
    expect(
      writes.find((w) => w.storageKey === STORAGE_KEYS.BROWSER.TABS_ACCESS)
        ?.value
    ).toBe(false)
    expect(
      writes.find((w) => w.storageKey === STORAGE_KEYS.CHAT.GROUNDED_ONLY_MODE)
        ?.value
    ).toBe(true)
  })

  it("getPreset returns undefined for unknown id", () => {
    expect(getPreset("nope")).toBeUndefined()
  })
})
