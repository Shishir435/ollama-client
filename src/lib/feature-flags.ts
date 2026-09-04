/**
 * Compile-time product gates. Agent Preview remains inert until its contracts,
 * runtime, perception transport, dry-run loop, and durable owner have landed.
 */
/** Direct build constant so Firefox can remove Agent branches and chunks. */
export const AGENT_PREVIEW_ENABLED =
  typeof __AGENT_PREVIEW_ENABLED__ !== "undefined" && __AGENT_PREVIEW_ENABLED__

export const FEATURE_FLAGS = Object.freeze({
  agentPreview: AGENT_PREVIEW_ENABLED
})
