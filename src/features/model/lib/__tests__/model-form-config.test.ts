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
      expect(config.validation?.min).toMatchObject({ value: limits.min })
      if ("max" in limits) {
        expect(config.validation?.max).toMatchObject({ value: limits.max })
      }
    }
  })
})
