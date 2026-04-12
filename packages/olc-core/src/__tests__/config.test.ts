import { mkdtemp } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { ConfigStore, DEFAULT_CONFIG } from "../config"

describe("ConfigStore", () => {
  it("creates default config when file is missing", async () => {
    const dir = await mkdtemp(join(tmpdir(), "olc-core-config-"))
    const store = new ConfigStore(join(dir, "config.json"))
    const loaded = await store.load()
    expect(loaded.defaultProviderId).toBe(DEFAULT_CONFIG.defaultProviderId)
    expect(loaded.providers.length).toBeGreaterThanOrEqual(3)
  })
})
