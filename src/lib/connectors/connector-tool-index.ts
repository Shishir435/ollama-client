import type { ToolDefinition, ToolParameterSchema } from "@/lib/tools/types"
import { effectiveConnectorRisk } from "./connector-risk"
import {
  MAX_TOOL_SCHEMA_CHARS,
  type StoredConnector,
  type StoredConnectorTool
} from "./types"

const MAX_TOOL_NAME = 64
const MAX_SLUG = 20
const MAX_DESCRIPTION = 1500

export interface ConnectorToolEntry {
  definition: ToolDefinition
  connector: StoredConnector
  tool: StoredConnectorTool
}

/** `My Mail Server` -> `my_mail_server`; never empty. */
export const connectorSlug = (name: string): string => {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, MAX_SLUG)
    .replace(/_+$/g, "")
  return slug || "connector"
}

const sanitizeToolName = (name: string): string =>
  name.replace(/[^a-zA-Z0-9_-]/g, "_") || "tool"

const schemaFits = (schema: Record<string, unknown>): boolean => {
  try {
    return JSON.stringify(schema).length <= MAX_TOOL_SCHEMA_CHARS
  } catch {
    return false
  }
}

/**
 * The server's schema passes through whole — `$defs`, `$ref`, `anyOf` and all —
 * because flattening it to `properties` breaks any tool with nested types.
 * Only the top level is pinned to an object, which every provider requires.
 */
const toParameterSchema = (
  schema: Record<string, unknown>
): ToolParameterSchema => {
  const { $schema: _ignored, ...rest } = schema
  const properties =
    rest.properties &&
    typeof rest.properties === "object" &&
    !Array.isArray(rest.properties)
      ? (rest.properties as Record<string, unknown>)
      : {}
  const required = Array.isArray(rest.required)
    ? rest.required.filter((key): key is string => typeof key === "string")
    : undefined
  return {
    ...rest,
    type: "object",
    properties,
    ...(required ? { required } : {})
  }
}

const describe = (
  connector: StoredConnector,
  tool: StoredConnectorTool
): string => {
  const body = tool.description?.trim() || tool.title?.trim() || tool.name
  return `[${connector.name}] ${body}`.slice(0, MAX_DESCRIPTION)
}

/**
 * Every enabled tool of every enabled connector, under the name the model
 * sees. Names are `<connector>_<tool>`, so no connector can shadow a built-in
 * or another connector; a collision that survives the prefix gets a numeric
 * suffix. The order is the stored order, so a name is stable for a given
 * configuration and the call path resolves exactly what the list offered.
 */
export const buildConnectorToolIndex = (
  connectors: readonly StoredConnector[]
): ConnectorToolEntry[] => {
  const entries: ConnectorToolEntry[] = []
  const taken = new Set<string>()
  for (const connector of connectors) {
    if (!connector.enabled) continue
    const slug = connectorSlug(connector.name)
    for (const tool of connector.tools) {
      if (!tool.enabled || !schemaFits(tool.inputSchema)) continue
      const base = `${slug}_${sanitizeToolName(tool.name)}`.slice(
        0,
        MAX_TOOL_NAME
      )
      let name = base
      for (let n = 2; taken.has(name); n += 1) {
        const suffix = `_${n}`
        name = `${base.slice(0, MAX_TOOL_NAME - suffix.length)}${suffix}`
      }
      taken.add(name)
      entries.push({
        connector,
        tool,
        definition: {
          name,
          description: describe(connector, tool),
          parameters: toParameterSchema(tool.inputSchema),
          category: "external",
          risk: effectiveConnectorRisk(tool),
          resultProvenance: "web-untrusted",
          requires: ["network"]
        }
      })
    }
  }
  return entries
}
