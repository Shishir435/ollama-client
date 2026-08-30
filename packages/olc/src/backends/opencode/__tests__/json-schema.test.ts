import type { ToolSchema } from "@opencode-ai/plugin"
import { describe, expect, it } from "vitest"
import { z } from "zod"
import {
  jsonSchemaToZodShape,
  jsonSchemaToZodType
} from "../plugin/json-schema.js"

/**
 * The plugin receives OpenCode's Zod instance through a narrow injected interface;
 * these tests drive the same translation with the repository's own Zod.
 */
const injected = z as unknown as ToolSchema

const objectOf = (jsonSchema: unknown) =>
  z.object(
    jsonSchemaToZodShape(jsonSchema, injected) as unknown as Record<
      string,
      z.ZodType
    >
  )

const typeOf = (jsonSchema: unknown) =>
  jsonSchemaToZodType(jsonSchema, injected) as unknown as z.ZodType

describe("jsonSchemaToZodShape", () => {
  it("maps declared property types and keeps optionality", () => {
    const schema = objectOf({
      type: "object",
      properties: {
        tabId: { type: "integer", description: "Tab identifier" },
        query: { type: "string" },
        verbose: { type: "boolean" }
      },
      required: ["tabId"]
    })

    expect(schema.parse({ tabId: 7 })).toEqual({ tabId: 7 })
    expect(schema.parse({ tabId: 7, query: "a", verbose: true })).toEqual({
      tabId: 7,
      query: "a",
      verbose: true
    })
    expect(schema.safeParse({}).success).toBe(false)
    expect(schema.safeParse({ tabId: "7" }).success).toBe(false)
  })

  it("returns an empty shape for a schema with no properties", () => {
    expect(jsonSchemaToZodShape({ type: "object" }, injected)).toEqual({})
    expect(jsonSchemaToZodShape(undefined, injected)).toEqual({})
  })

  it("keeps string enums exact", () => {
    const schema = objectOf({
      type: "object",
      properties: { scope: { type: "string", enum: ["tab", "window"] } },
      required: ["scope"]
    })

    expect(schema.parse({ scope: "tab" })).toEqual({ scope: "tab" })
    expect(schema.safeParse({ scope: "everything" }).success).toBe(false)
  })

  it("accepts anything for constructs it cannot translate", () => {
    const schema = objectOf({
      type: "object",
      properties: {
        filter: { anyOf: [{ type: "string" }, { type: "number" }] }
      },
      required: ["filter"]
    })

    expect(schema.parse({ filter: "text" })).toEqual({ filter: "text" })
    expect(schema.parse({ filter: 5 })).toEqual({ filter: 5 })
  })

  it("translates nested arrays and objects", () => {
    const schema = typeOf({
      type: "array",
      items: {
        type: "object",
        properties: { url: { type: "string" } },
        required: ["url"]
      }
    })

    expect(schema.parse([{ url: "https://example.com" }])).toEqual([
      { url: "https://example.com" }
    ])
    expect(schema.safeParse([{}]).success).toBe(false)
  })
})
