import { describe, expect, it } from "vitest"
import { DEFAULT_MODEL_CONFIG } from "@/lib/constants"
import {
  compactModelConfig,
  getStoredModelConfig,
  modelConfigKey,
  parseStoredModelConfigMap,
  resolveModelConfig
} from "@/lib/model-config-utils"

describe("resolveModelConfig", () => {
  it("defaults the context window to Auto when no stored config exists", () => {
    expect(resolveModelConfig().num_ctx).toBe(0)
    expect(resolveModelConfig().num_ctx).toBe(DEFAULT_MODEL_CONFIG.num_ctx)
  })

  it("moves a stored old 65536 default to Auto", () => {
    expect(resolveModelConfig({ num_ctx: 65536 }).num_ctx).toBe(0)
  })

  it("keeps 65536 when the user chose it themselves", () => {
    expect(
      resolveModelConfig({ num_ctx: 65536, num_ctx_pinned: true } as never)
        .num_ctx
    ).toBe(65536)
  })

  it("never touches a window the user edited to anything else", () => {
    for (const num_ctx of [2048, 8192, 32768, 131072]) {
      expect(resolveModelConfig({ num_ctx }).num_ctx).toBe(num_ctx)
    }
  })

  it("drops the migrated default from the stored sparse config", () => {
    expect(compactModelConfig({ num_ctx: 65536, temperature: 0.2 })).toEqual({
      temperature: 0.2
    })
    expect(
      compactModelConfig({ num_ctx: 65536, num_ctx_pinned: true } as never)
    ).toEqual({ num_ctx: 65536, num_ctx_pinned: true })
  })

  it("upgrades old 6144 context default to the current default", () => {
    expect(resolveModelConfig({ num_ctx: 6144 }).num_ctx).toBe(
      DEFAULT_MODEL_CONFIG.num_ctx
    )
  })

  it("preserves custom context size", () => {
    expect(resolveModelConfig({ num_ctx: 32768 }).num_ctx).toBe(32768)
  })
})

describe("provider-scoped model configs", () => {
  const configs = {
    shared: { reasoning_effort: "medium" as const },
    "provider-a::shared": { reasoning_effort: "low" as const },
    "provider-b::shared": { reasoning_effort: "high" as const }
  }

  it("uses collision-safe keys and prefers the matching provider", () => {
    expect(modelConfigKey("shared", "provider-a")).toBe("provider-a::shared")
    expect(getStoredModelConfig(configs, "shared", "provider-a")).toEqual({
      reasoning_effort: "low"
    })
    expect(getStoredModelConfig(configs, "shared", "provider-b")).toEqual({
      reasoning_effort: "high"
    })
  })

  it("inherits only provider-neutral settings from legacy bare model keys", () => {
    const legacyConfigs = {
      ...configs,
      shared: { temperature: 0.25, reasoning_effort: "medium" as const }
    }

    expect(getStoredModelConfig(legacyConfigs, "shared", "provider-c")).toEqual(
      {
        temperature: 0.25
      }
    )
  })

  it("preserves reasoning effort for unscoped legacy callers", () => {
    expect(getStoredModelConfig(configs, "shared")).toEqual({
      reasoning_effort: "medium"
    })
  })
})

describe("parseStoredModelConfigMap", () => {
  it("rejects malformed stored settings", () => {
    expect(
      parseStoredModelConfigMap({ model: { temperature: "hot" } })
    ).toEqual({})
  })

  it("accepts partial model settings", () => {
    expect(parseStoredModelConfigMap({ model: { temperature: 0.25 } })).toEqual(
      { model: { temperature: 0.25 } }
    )
  })

  it("accepts known reasoning efforts and rejects unknown values", () => {
    expect(
      parseStoredModelConfigMap({ model: { reasoning_effort: "xhigh" } })
    ).toEqual({ model: { reasoning_effort: "xhigh" } })
    expect(
      parseStoredModelConfigMap({ model: { reasoning_effort: "extreme" } })
    ).toEqual({})
  })
})
