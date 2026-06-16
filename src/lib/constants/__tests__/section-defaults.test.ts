import { describe, expect, it } from "vitest"
import {
  DEFAULT_CONTENT_EXTRACTION_CONFIG,
  DEFAULT_EMBEDDING_CONFIG,
  DEFAULT_FILE_UPLOAD_CONFIG,
  STORAGE_KEYS
} from "@/lib/constants"
import {
  getDefaultedSectionIds,
  getSectionDefaults,
  SECTION_DEFAULTS
} from "../section-defaults"

// Every leaf string value in STORAGE_KEYS — the universe of valid storage keys.
const flattenKeys = (obj: object): string[] =>
  Object.values(obj).flatMap((v) =>
    typeof v === "string" ? [v] : flattenKeys(v as object)
  )
const VALID_STORAGE_KEYS = new Set(flattenKeys(STORAGE_KEYS))

// Config-object storage keys → the DEFAULT_* object that backs them, for
// verifying nested-field values are referenced, not copied.
const asRecord = (obj: object): Record<string, unknown> =>
  obj as Record<string, unknown>
const CONFIG_SOURCES: Record<string, Record<string, unknown>> = {
  [STORAGE_KEYS.EMBEDDINGS.CONFIG]: asRecord(DEFAULT_EMBEDDING_CONFIG),
  [STORAGE_KEYS.BROWSER.CONTENT_EXTRACTION_CONFIG]: asRecord(
    DEFAULT_CONTENT_EXTRACTION_CONFIG
  ),
  [STORAGE_KEYS.FILE_UPLOAD.CONFIG]: asRecord(DEFAULT_FILE_UPLOAD_CONFIG)
}

describe("section-defaults", () => {
  it("uses only real storage keys", () => {
    for (const entries of Object.values(SECTION_DEFAULTS)) {
      for (const entry of entries) {
        expect(VALID_STORAGE_KEYS.has(entry.storageKey), entry.storageKey).toBe(
          true
        )
      }
    }
  })

  it("nested-field values match their source DEFAULT_* object", () => {
    for (const [sectionId, entries] of Object.entries(SECTION_DEFAULTS)) {
      for (const entry of entries) {
        if (!entry.field) continue
        const source = CONFIG_SOURCES[entry.storageKey]
        expect(
          source,
          `${sectionId}: no source for ${entry.storageKey}`
        ).toBeDefined()
        // field must exist on the source object...
        expect(entry.field in source, `${sectionId}.${entry.field}`).toBe(true)
        // ...and the value must be the source's value (referenced, not copied).
        expect(entry.value, `${sectionId}.${entry.field}`).toBe(
          source[entry.field]
        )
      }
    }
  })

  it("scalar entries omit field", () => {
    for (const entry of getSectionDefaults("prompt-budget")) {
      expect(entry.field).toBeUndefined()
    }
  })

  it("getSectionDefaults returns the section's entries", () => {
    const chunking = getSectionDefaults("chunking")
    expect(chunking.length).toBeGreaterThan(0)
    expect(chunking.map((e) => e.field)).toContain("chunkSize")
  })

  it("getSectionDefaults returns [] for an unknown section", () => {
    expect(getSectionDefaults("nope")).toEqual([])
  })

  it("does not expose per-model configs as flat field writes", () => {
    expect(getSectionDefaults("model-parameters")).toEqual([])
  })

  it("every defaulted section is non-empty", () => {
    for (const id of getDefaultedSectionIds()) {
      expect(getSectionDefaults(id).length, id).toBeGreaterThan(0)
    }
  })
})
