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

/** What `stableTag` appends: an underscore, a digit, five base-36 characters. */
const TAG_SUFFIX = /_[0-9][0-9a-z]{5}$/

/** FNV-1a, base 36: a short, stable tag; not a security boundary. */
const stableTag = (value: string): string => {
  let hash = 0x811c9dc5
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  const unsigned = hash >>> 0
  /**
   * A leading digit keeps tags apart from ordinary words: `_search` and
   * `_create` end real tool names, `_4k3x9q` does not.
   */
  return `${unsigned % 10}${unsigned.toString(36).padStart(6, "0").slice(-5)}`
}

/**
 * The identity a connector tool's approvals are bound to: the endpoint, the
 * connector's own id and the server's raw tool name. Shaped like a URL so the
 * approval prompt shows the server's host. A grant for one connector or one
 * tool can never match another, and a connector moved to a new endpoint starts
 * with no grants.
 */
export const connectorGrantScope = (
  connector: StoredConnector,
  toolName: string
): string => {
  let endpoint = connector.url
  try {
    const url = new URL(connector.url)
    /**
     * A query can select a tenant, so it is part of the identity; it goes in
     * as a tag, since a query string may carry a key the approval list
     * should not display.
     */
    const query = url.search ? `~${stableTag(url.search)}` : ""
    endpoint = `${url.origin}${url.pathname}${query}`
  } catch {
    // Stored URLs are validated on save; keep the raw value otherwise.
  }
  return `${endpoint}#${connector.id}/${encodeURIComponent(toolName)}`
}

/**
 * Every enabled tool of every enabled connector, under the name the model
 * sees: `<connector>_<tool>`.
 *
 * A name must never move from one server's tool to another's: approvals and
 * pending calls are keyed by it. So collisions are judged against every
 * stored tool, enabled or not, and against the built-in names in `reserved`;
 * each colliding name gets a tag derived from its own connector id and raw
 * tool name rather than a position. A name that had to be sanitized or
 * truncated is tagged too, always: otherwise a refresh that replaces `a.b`
 * with `a_b` would hand `a.b`'s name to a different tool. Turning a connector
 * off, reordering, a neighbour's rename or a server's own rename can change a
 * name only by retiring it, never by handing it to someone else.
 */
export const buildConnectorToolIndex = (
  connectors: readonly StoredConnector[],
  reserved: ReadonlySet<string> = new Set()
): ConnectorToolEntry[] => {
  const baseOf = (connector: StoredConnector, tool: StoredConnectorTool) =>
    `${connectorSlug(connector.name)}_${sanitizeToolName(tool.name)}`.slice(
      0,
      MAX_TOOL_NAME
    )
  const counts = new Map<string, number>()
  for (const connector of connectors) {
    for (const tool of connector.tools) {
      const base = baseOf(connector, tool)
      counts.set(base, (counts.get(base) ?? 0) + 1)
    }
  }

  const entries: ConnectorToolEntry[] = []
  const taken = new Set<string>(reserved)
  for (const connector of connectors) {
    for (const tool of connector.tools) {
      const base = baseOf(connector, tool)
      let name = base
      const lossy = base !== `${connectorSlug(connector.name)}_${tool.name}`
      /**
       * A clean name that already ends like a tag is tagged as well, so the
       * set of untagged names and the set of tagged ones can never overlap: a
       * server's clean `a_b_k3x9q2` can't land on another tool's tagged name.
       */
      const tagShaped = TAG_SUFFIX.test(base)
      if (
        lossy ||
        tagShaped ||
        (counts.get(base) ?? 0) > 1 ||
        reserved.has(base)
      ) {
        const suffix = `_${stableTag(`${connector.id}\u0000${tool.name}`)}`
        name = `${base.slice(0, MAX_TOOL_NAME - suffix.length)}${suffix}`
      }
      /** A tag collision is not resolved by position: the tool is not offered. */
      if (taken.has(name)) continue
      taken.add(name)
      if (!connector.enabled || !tool.enabled) continue
      if (!schemaFits(tool.inputSchema)) continue
      entries.push({
        connector,
        tool,
        definition: {
          name,
          description: describe(connector, tool),
          parameters: toParameterSchema(tool.inputSchema),
          connectorId: connector.id,
          category: "external",
          risk: effectiveConnectorRisk(tool),
          resultProvenance: "web-untrusted",
          requires: ["network"],
          grantScopeResolver: () => connectorGrantScope(connector, tool.name)
        }
      })
    }
  }
  return entries
}
