import type {
  AgentElement,
  AgentFrameObservation,
  AgentObservation,
  AgentSnapshotIdentity
} from "@ollama-client/contracts"

/** The root frame's identity: what a command names and a scroll without a ref acts on. */
export const rootAgentSnapshotIdentity = (
  observation: AgentObservation
): AgentSnapshotIdentity => ({
  snapshotId: observation.snapshotId,
  generation: observation.generation,
  tabId: observation.tabId,
  frameId: observation.frameId,
  documentId: observation.documentId
})

export const agentFrameRecord = (
  observation: AgentObservation,
  frameId: number
): AgentFrameObservation | undefined =>
  observation.frames.find((frame) => frame.frameId === frameId)

/**
 * The identity an element's own frame holds, which is what the executor binds
 * the effect to. An element can only come from a frame the observation read,
 * so a missing or unread frame is a broken observation rather than a stale
 * one, and is reported as such.
 */
export const agentFrameSnapshotIdentity = (
  observation: AgentObservation,
  element: Pick<AgentElement, "frameId" | "ref">
): AgentSnapshotIdentity => {
  const frame = agentFrameRecord(observation, element.frameId)
  if (
    !frame ||
    frame.access !== "ok" ||
    frame.documentId === undefined ||
    frame.snapshotId === undefined ||
    frame.generation === undefined
  ) {
    throw new Error("Agent element names a frame the observation did not read")
  }
  return {
    snapshotId: frame.snapshotId,
    generation: frame.generation,
    tabId: observation.tabId,
    frameId: frame.frameId,
    documentId: frame.documentId
  }
}

/**
 * The page a child-frame element is actually on, or nothing for an element in
 * the root frame — the root's own url is the effect's `sourceUrl` already.
 */
export const agentFramePage = (
  observation: AgentObservation,
  element: Pick<AgentElement, "frameId">
): { url: string; origin: string } | undefined => {
  if (element.frameId === observation.frameId) return undefined
  const frame = agentFrameRecord(observation, element.frameId)
  if (!frame || frame.access !== "ok" || frame.url === undefined) {
    throw new Error("Agent element names a frame the observation did not read")
  }
  return { url: frame.url, origin: frame.origin }
}
