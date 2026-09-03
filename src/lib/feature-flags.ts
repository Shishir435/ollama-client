/**
 * Compile-time product gates. Agent Preview remains inert until its contracts,
 * runtime, perception transport, dry-run loop, and durable owner have landed.
 */
/** Direct constant so disabled Agent branches can be removed from MV3 IIFEs. */
export const AGENT_PREVIEW_ENABLED = false as const

export const FEATURE_FLAGS = Object.freeze({
  agentPreview: AGENT_PREVIEW_ENABLED
})
