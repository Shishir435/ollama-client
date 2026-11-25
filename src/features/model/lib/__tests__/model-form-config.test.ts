import { describe, expect, it } from "vitest"
import {
  fieldValidations,
  getNumberInputConfigs,
  MODEL_FIELD_LIMITS
} from "../model-form-config"

describe("model field limits", () => {
  it("accepts exactly the values the inputs' own bounds allow", () => {
    for (const [field, limits] of Object.entries(MODEL_FIELD_LIMITS)) {
      const check = fieldValidations[field as keyof typeof fieldValidations]
      expect(check, field).toBeDefined()
      expect(check?.(limits.min), `${field} at min`).toBe(true)
      expect(check?.(limits.min - 1), `${field} below min`).toBe(false)
      if ("max" in limits) {
        expect(check?.(limits.max), `${field} at max`).toBe(true)
        expect(check?.(limits.max + 1), `${field} above max`).toBe(false)
      }
    }
  })

  it("takes Auto for the context window but nothing else under its minimum", () => {
    expect(fieldValidations.num_ctx?.(0)).toBe(true)
    expect(fieldValidations.num_ctx?.(1)).toBe(false)
    expect(fieldValidations.num_ctx?.(-1)).toBe(false)
    expect(fieldValidations.num_ctx?.(16384)).toBe(true)
  })

  it("shows the effective window as the context input's Auto label", () => {
    const t = ((key: string, values?: Record<string, unknown>) =>
      values ? `${key}:${values.value}` : key) as never
    const auto = (effectiveContext?: number) =>
      getNumberInputConfigs(t, { effectiveContext }).find(
        (config) => config.name === "num_ctx"
      )

    expect(auto(4096)?.autoValue).toBe(0)
    expect(auto(4096)?.autoLabel).toBe(
      "settings.model.parameters.num_ctx.auto:4,096"
    )
    expect(auto()?.autoLabel).toBe(
      "settings.model.parameters.num_ctx.auto:16,384"
    )
  })

  it("rejects NaN and non-numbers", () => {
    expect(fieldValidations.num_ctx?.(Number.NaN)).toBe(false)
    expect(fieldValidations.top_k?.("5" as never)).toBe(false)
  })

  it("feeds the same constants into each input's validation message", () => {
    const configs = getNumberInputConfigs(((key: string) => key) as never)
    for (const config of configs) {
      const limits =
        MODEL_FIELD_LIMITS[config.name as keyof typeof MODEL_FIELD_LIMITS]
      if (!limits) continue
      /** Context takes Auto below its minimum, so it validates by function. */
      if (config.name === "num_ctx") continue
      expect(config.validation?.min).toMatchObject({ value: limits.min })
      if ("max" in limits) {
        expect(config.validation?.max).toMatchObject({ value: limits.max })
      }
    }
  })
})
