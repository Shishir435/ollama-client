/**
 * JSON Schema → Zod translation for the bridge plugin.
 *
 * Contract: the client declares its tools as OpenAI function definitions, whose
 * `parameters` are JSON Schema. OpenCode's plugin `tool()` helper wants a Zod raw
 * shape instead, so the manifest is translated at plugin load. The Zod instance is
 * injected (`tool.schema`) rather than imported, because the plugin runs inside
 * OpenCode's runtime and must not pin its own copy.
 *
 * Unsupported constructs (`anyOf`, `$ref`, tuples, mixed-type enums) degrade to
 * `any`: a permissive argument still reaches the client, which validates against the
 * real schema, whereas a translation error would drop the tool.
 */
import type { ToolSchema, ZodLike } from "@opencode-ai/plugin"

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value)

/** Translate one JSON Schema node into a Zod type. */
export const jsonSchemaToZodType = (node: unknown, z: ToolSchema): ZodLike => {
  if (!isRecord(node)) return z.any()

  if (Array.isArray(node.enum) && node.enum.length > 0) {
    const values = node.enum.filter(
      (value): value is string => typeof value === "string"
    )
    return values.length === node.enum.length ? z.enum(values) : z.any()
  }

  const declared = Array.isArray(node.type)
    ? node.type.find((entry) => entry !== "null")
    : node.type

  switch (declared) {
    case "string":
      return z.string()
    case "number":
    case "integer":
      return z.number()
    case "boolean":
      return z.boolean()
    case "array":
      return z.array(jsonSchemaToZodType(node.items, z))
    case "object": {
      const shape = jsonSchemaToZodShape(node, z)
      return Object.keys(shape).length > 0
        ? z.object(shape)
        : z.record(z.string(), z.any())
    }
    default:
      return z.any()
  }
}

/**
 * Translate a JSON Schema object into the Zod raw shape OpenCode expects. A schema
 * with no usable `properties` yields an empty shape, which registers a zero-argument
 * tool rather than failing registration.
 */
export const jsonSchemaToZodShape = (
  schema: unknown,
  z: ToolSchema
): Record<string, ZodLike> => {
  if (!isRecord(schema) || !isRecord(schema.properties)) return {}

  const required = new Set(
    Array.isArray(schema.required)
      ? schema.required.filter(
          (entry): entry is string => typeof entry === "string"
        )
      : []
  )

  const shape: Record<string, ZodLike> = {}
  for (const [name, node] of Object.entries(schema.properties)) {
    let type = jsonSchemaToZodType(node, z)
    if (isRecord(node) && typeof node.description === "string") {
      const description = node.description.trim()
      if (description) type = type.describe(description)
    }
    shape[name] = required.has(name) ? type : type.optional()
  }
  return shape
}
