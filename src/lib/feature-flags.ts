/**
 * Compile-time product gates. Agent Preview remains inert until its contracts,
 * runtime, perception transport, dry-run loop, and durable owner have landed.
 */
/** Direct build constant so Firefox can remove Agent branches and chunks. */
export const AGENT_PREVIEW_ENABLED =
  typeof __AGENT_PREVIEW_ENABLED__ !== "undefined" && __AGENT_PREVIEW_ENABLED__

/**
 * The Agent run-record dump on the background console. Development builds
 * only — the record quotes page text, so a store build erases it.
 */
export const AGENT_DEBUG_REPORT_ENABLED =
  typeof __AGENT_DEBUG_REPORT__ !== "undefined" && __AGENT_DEBUG_REPORT__

export const AGENT_WEBMCP_ENABLED =
  typeof __AGENT_WEBMCP_ENABLED__ !== "undefined" && __AGENT_WEBMCP_ENABLED__

/** True in tests without injected defines; folded away in disabled builds. */
export const AGENT_WEBMCP_COMPILED =
  typeof __AGENT_WEBMCP_ENABLED__ === "undefined" || __AGENT_WEBMCP_ENABLED__

export const FEATURE_FLAGS = Object.freeze({
  agentPreview: AGENT_PREVIEW_ENABLED,
  agentWebMcp: AGENT_WEBMCP_ENABLED,
  agentDebugReport: AGENT_DEBUG_REPORT_ENABLED
})
