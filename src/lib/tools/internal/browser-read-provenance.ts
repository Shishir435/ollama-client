import type { ToolResult, ToolResultSource } from "../types"

/**
 * These legacy read tools have no browser document/snapshot identity. Give
 * each delivered answer a reference without inventing one or describing a
 * cached extraction as a fresh observation. The body stays tool data under
 * the existing untrusted-result fence; no page is copied to a second store.
 */
export const browserReadResult = (
  tool: "current_tab" | "read_tab",
  tabId: number,
  content: string,
  source: ToolResultSource
): ToolResult => {
  const id = `browser-read:${crypto.randomUUID()}`
  const reference = {
    id,
    kind: "page_tool_claim",
    validity: "incomplete",
    tool,
    tabId,
    retrievedAt: Date.now(),
    documentIdentity: "unavailable",
    observationTime: "unavailable"
  }
  return {
    content: `Source reference: ${JSON.stringify(reference)}\nThis is a retained page-tool read, not proof of current document state.\n\n${content}`,
    sources: [{ ...source, id }]
  }
}
