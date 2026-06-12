import { describe, expect, it } from "vitest"
import { DEFAULT_MODEL_CONFIG } from "@/lib/constants"
import { resolveModelConfig } from "@/lib/model-config-utils"

describe("resolveModelConfig", () => {
  it("uses 64k context when no stored config exists", () => {
    expect(resolveModelConfig().num_ctx).toBe(DEFAULT_MODEL_CONFIG.num_ctx)
  })

  it("upgrades old 6144 context default", () => {
    expect(resolveModelConfig({ num_ctx: 6144 }).num_ctx).toBe(
      DEFAULT_MODEL_CONFIG.num_ctx
    )
  })

  it("preserves custom context size", () => {
    expect(resolveModelConfig({ num_ctx: 32768 }).num_ctx).toBe(32768)
  })
})
