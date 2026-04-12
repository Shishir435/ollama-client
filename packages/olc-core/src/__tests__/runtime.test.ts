import { mkdtemp } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { ConfigStore } from "../config"
import { RuntimeContext } from "../runtime"

describe("RuntimeContext", () => {
  it("falls back to default provider when model mapping is absent", async () => {
    const dir = await mkdtemp(join(tmpdir(), "olc-core-runtime-"))
    const store = new ConfigStore(join(dir, "config.json"))
    const runtime = new RuntimeContext(store)

    const provider = await runtime.resolveProviderForModel("some-model")
    expect(provider.id).toBe("ollama")
  })

  it("uses explicit model mapping when present", async () => {
    const dir = await mkdtemp(join(tmpdir(), "olc-core-runtime-"))
    const store = new ConfigStore(join(dir, "config.json"))
    const runtime = new RuntimeContext(store)
    const config = await runtime.getConfig()
    config.providers = config.providers.map((provider) =>
      provider.id === "lm-studio" ? { ...provider, enabled: true } : provider
    )
    config.modelMappings["mapped-model"] = "lm-studio"
    await runtime.saveConfig(config)

    const provider = await runtime.resolveProviderForModel("mapped-model")
    expect(provider.id).toBe("lm-studio")
  })
})
