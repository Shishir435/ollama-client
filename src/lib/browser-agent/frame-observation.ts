import {
  type AgentFrameAccess,
  type AgentFrameObservation,
  type AgentObservation,
  AgentObservationSchema,
  MAX_AGENT_OBSERVED_ELEMENTS,
  MAX_AGENT_OBSERVED_FRAMES
} from "@ollama-client/contracts"

import type { TabAccess } from "@/lib/browser-tab-access"
import { AGENT_OBSERVATION_LIMITS } from "./observation-builder"

/** A frame as the browser reports it, before the run has decided anything about it. */
export interface AgentBrowserFrame {
  frameId: number
  parentFrameId: number
  url: string
  documentId?: string
}

const originOf = (url: string): string | undefined => {
  try {
    const parsed = new URL(url)
    return parsed.protocol === "http:" || parsed.protocol === "https:"
      ? parsed.origin
      : undefined
  } catch {
    return undefined
  }
}

/**
 * Whether the run may read a child frame, decided before a byte of it is
 * requested. The browser's own limits come first, then the user's exclusions,
 * then the run's authorization: a frame on an origin the user never approved
 * for this run is a page the user was not asked about, however readable it
 * is. An `about:blank` or `srcdoc` frame has no origin of its own and is
 * reported as restricted rather than inherited from its parent.
 */
export const authorizeAgentFrame = async (
  frame: AgentBrowserFrame,
  input: {
    allowedOrigins: readonly string[]
    classifyAccess: (url?: string) => Promise<TabAccess>
  }
): Promise<{ origin: string; access: AgentFrameAccess } | undefined> => {
  const origin = originOf(frame.url)
  if (!origin) return undefined
  let access: AgentFrameAccess
  try {
    access = await input.classifyAccess(frame.url)
  } catch {
    access = "restricted"
  }
  if (access === "ok" && !input.allowedOrigins.includes(origin)) {
    access = "unauthorized_origin"
  }
  return { origin, access }
}

export interface AgentChildFrameResult {
  frame: AgentBrowserFrame
  origin: string
  access: AgentFrameAccess
  observation?: AgentObservation
}

/**
 * The child frames a page has, in the order the run will read them, and the
 * ones past the cap. Frame ids rise in creation order, so the earliest frames
 * — the ones the page laid out first — are the ones that fit.
 */
export const selectAgentChildFrames = (
  frames: readonly AgentBrowserFrame[]
): { selected: AgentBrowserFrame[]; overflow: AgentBrowserFrame[] } => {
  const children = frames
    .filter((frame) => frame.frameId !== 0)
    .sort((first, second) => first.frameId - second.frameId)
  const capacity = MAX_AGENT_OBSERVED_FRAMES - 1
  return {
    selected: children.slice(0, capacity),
    overflow: children.slice(capacity)
  }
}

/** What the root left for the next child frame to fill. */
export const remainingAgentElementBudget = (
  root: AgentObservation,
  children: readonly AgentChildFrameResult[]
): number =>
  Math.max(
    0,
    MAX_AGENT_OBSERVED_ELEMENTS -
      root.elements.length -
      children.reduce(
        (total, child) => total + (child.observation?.elements.length ?? 0),
        0
      )
  )

const blockedFrame = (
  frame: AgentBrowserFrame,
  origin: string,
  access: Exclude<AgentFrameAccess, "ok">
): AgentFrameObservation => ({
  frameId: frame.frameId,
  parentFrameId: frame.parentFrameId,
  ...(frame.documentId ? { documentId: frame.documentId } : {}),
  origin,
  access
})

/**
 * One observation for the page, from the root frame's observation and every
 * child the run read or refused. The root keeps its identity, url, title,
 * scroll and document text — the composite is that page, seen more fully —
 * and the children contribute their controls, their frame records, and the
 * text a user would see in them.
 */
export const composeAgentFrameObservations = (input: {
  root: AgentObservation
  children: readonly AgentChildFrameResult[]
  overflow?: readonly AgentBrowserFrame[]
}): AgentObservation => {
  if (input.children.length === 0 && !input.overflow?.length) return input.root
  const frames: AgentFrameObservation[] = [input.root.frames[0]]
  const elements = [...input.root.elements]
  const texts = [input.root.visibleText]
  for (const child of input.children) {
    if (child.access === "ok" && child.observation) {
      frames.push({
        ...child.observation.frames[0],
        parentFrameId: child.frame.parentFrameId
      })
      elements.push(...child.observation.elements)
      if (child.observation.visibleText)
        texts.push(child.observation.visibleText)
      continue
    }
    frames.push(
      blockedFrame(
        child.frame,
        child.origin,
        child.access === "ok" ? "unreadable" : child.access
      )
    )
  }
  for (const frame of input.overflow ?? []) {
    frames.push(
      blockedFrame(frame, originOf(frame.url) ?? "null", "frame_limit")
    )
  }
  return AgentObservationSchema.parse({
    ...input.root,
    frames,
    elements,
    visibleText: texts
      .join("\n")
      .slice(0, AGENT_OBSERVATION_LIMITS.visibleTextChars)
  })
}
