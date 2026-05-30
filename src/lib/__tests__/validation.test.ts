import { describe, expect, it } from "vitest"
import { z } from "zod"
import { safeJsonParse } from "../validation"

describe("safeJsonParse", () => {
  const TestSchema = z.object({
    name: z.string(),
    age: z.number()
  })

  it("returns parsed data when JSON and schema both valid", () => {
    const result = safeJsonParse('{"name":"Alice","age":30}', TestSchema)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data).toEqual({ name: "Alice", age: 30 })
    }
  })

  it("returns SyntaxError for malformed JSON", () => {
    const result = safeJsonParse("not json", TestSchema)
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error).toBeInstanceOf(SyntaxError)
    }
  })

  it("returns ZodError when JSON is valid but schema fails", () => {
    const result = safeJsonParse('{"name":123}', TestSchema)
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.constructor.name).toBe("ZodError")
    }
  })

  it("works with passthrough schemas (extra keys preserved)", () => {
    const Loose = z.object({ id: z.string() }).passthrough()
    const result = safeJsonParse('{"id":"1","extra":"kept"}', Loose)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data).toEqual({ id: "1", extra: "kept" })
    }
  })

  it("works with array schemas", () => {
    const ArraySchema = z.array(z.string())
    const result = safeJsonParse('["a","b","c"]', ArraySchema)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data).toEqual(["a", "b", "c"])
    }
  })

  it("applies transforms and defaults", () => {
    const WithDefault = z.object({
      name: z.string(),
      count: z.number().default(0)
    })
    const result = safeJsonParse('{"name":"test"}', WithDefault)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.count).toBe(0)
    }
  })
})
