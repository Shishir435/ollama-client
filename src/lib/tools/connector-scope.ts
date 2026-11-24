import type { ToolContext, ToolDefinition } from "./types"

/**
 * Whether a chat has switched off the connector behind a tool. Tools that
 * belong to no connector are never hidden by this.
 */
export const isHiddenByConnectorScope = (
  definition: Pick<ToolDefinition, "connectorId"> | undefined,
  ctx: Pick<ToolContext, "disabledConnectorIds"> | undefined
): boolean =>
  Boolean(
    definition?.connectorId &&
    ctx?.disabledConnectorIds?.includes(definition.connectorId)
  )

/** Drop the tools of connectors a chat switched off. */
export const withinConnectorScope = (
  definitions: readonly ToolDefinition[],
  disabledConnectorIds: readonly string[] | undefined
): ToolDefinition[] => {
  if (!disabledConnectorIds?.length) return [...definitions]
  const ctx = { disabledConnectorIds }
  return definitions.filter(
    (definition) => !isHiddenByConnectorScope(definition, ctx)
  )
}
