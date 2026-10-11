import type {
  AgentCssRect,
  AgentObservation,
  AgentScreenshot,
  AgentSnapshotIdentity,
  AgentVisualFrame
} from "@ollama-client/contracts"
import type { AgentHitTestResult, AgentSensitiveRegions } from "./control-port"
import {
  agentFrameSnapshotIdentity,
  rootAgentSnapshotIdentity
} from "./frame-identity"
import { rectThroughFrame, sameCssRect } from "./screenshot-geometry"

export interface AgentVisualRegions {
  rects: AgentCssRect[]
  scroll: { x: number; y: number }
  frames: AgentVisualFrame[]
  frameLimitations: NonNullable<AgentScreenshot["frameLimitations"]>
}

/** Compose masks only through documents the observation already authorized and read. */
export const collectAgentVisualRegions = async (input: {
  observation: AgentObservation
  regions(identity: AgentSnapshotIdentity): Promise<AgentSensitiveRegions>
  geometry?(
    frameId: number,
    viewports: { frameId: number; width: number; height: number }[]
  ): Promise<{ content: AgentCssRect; border: AgentCssRect } | undefined>
}): Promise<AgentVisualRegions | undefined> => {
  const observation = input.observation
  const root = await input.regions(rootAgentSnapshotIdentity(observation))
  if (!root) return undefined
  const result: AgentVisualRegions = {
    rects: [...root.rects],
    scroll: root.scroll,
    frames: [],
    frameLimitations: []
  }
  if (!input.geometry || !root.frameRects) return result
  const readings = new Map<number, NonNullable<AgentSensitiveRegions>>([
    [observation.frameId, root]
  ])
  const eligible = observation.frames.filter(
    (frame) =>
      frame.frameId !== observation.frameId &&
      frame.access === "ok" &&
      frame.documentId &&
      frame.snapshotId &&
      frame.generation !== undefined
  )
  for (const frame of eligible) {
    const reading = await input
      .regions(
        agentFrameSnapshotIdentity(observation, {
          frameId: frame.frameId,
          ref: ""
        })
      )
      .catch(() => null)
    if (reading?.viewport && reading.frameRects)
      readings.set(frame.frameId, reading)
  }
  const viewports = [...readings].flatMap(([frameId, reading]) =>
    reading.viewport ? [{ frameId, ...reading.viewport }] : []
  )
  const remaining = [...eligible]
  for (let pass = 0; pass < eligible.length && remaining.length; pass++) {
    for (const frame of [...remaining]) {
      const parent =
        frame.parentFrameId === observation.frameId
          ? undefined
          : result.frames.find(
              (candidate) => candidate.frameId === frame.parentFrameId
            )
      if (frame.parentFrameId !== observation.frameId && !parent) continue
      remaining.splice(remaining.indexOf(frame), 1)
      await revealFrame(input, frame, parent, readings, viewports, result)
    }
  }
  result.frameLimitations.push(
    ...remaining.map((frame) => ({
      frameId: frame.frameId,
      reason: "parent_masked" as const
    }))
  )
  return result
}

/** Follow browser hit tests down one exact owner chain, never by overlapping regions. */
export const hitTestAgentVisualPoint = async (input: {
  root: AgentSnapshotIdentity
  frames: readonly AgentVisualFrame[]
  point: { x: number; y: number }
  hitTest(
    identity: AgentSnapshotIdentity,
    point: { x: number; y: number }
  ): Promise<AgentHitTestResult>
}): Promise<{
  hit: AgentHitTestResult
  point: { x: number; y: number }
  path: AgentVisualFrame[]
}> => {
  let identity = input.root
  let point = input.point
  const path: AgentVisualFrame[] = []
  for (let depth = 0; depth <= input.frames.length; depth++) {
    const hit = await input.hitTest(identity, point)
    if (!hit?.frameElement) return { hit, point, path }
    const matches = input.frames.filter(
      (frame) =>
        frame.parentFrameId === identity.frameId &&
        hit.frameRect &&
        sameCssRect(frame.owner, hit.frameRect)
    )
    if (matches.length !== 1) return { hit, point, path }
    const frame = matches[0]
    point = {
      x: (input.point.x - frame.region.x) / frame.scaleX,
      y: (input.point.y - frame.region.y) / frame.scaleY
    }
    if (
      point.x < 0 ||
      point.y < 0 ||
      point.x >= frame.region.width / frame.scaleX ||
      point.y >= frame.region.height / frame.scaleY
    )
      return { hit: null, point, path }
    path.push(frame)
    identity = {
      snapshotId: frame.snapshotId,
      generation: frame.generation,
      tabId: frame.tabId,
      frameId: frame.frameId,
      documentId: frame.documentId
    }
  }
  return { hit: null, point, path }
}

type VisualInput = Parameters<typeof collectAgentVisualRegions>[0]
type FrameReading = NonNullable<AgentSensitiveRegions>
const revealFrame = async (
  input: VisualInput,
  frame: AgentObservation["frames"][number],
  parent: AgentVisualFrame | undefined,
  readings: Map<number, FrameReading>,
  viewports: { frameId: number; width: number; height: number }[],
  result: AgentVisualRegions
): Promise<void> => {
  const reading = readings.get(frame.frameId)
  const parentReading = readings.get(frame.parentFrameId ?? -1)
  const box =
    reading && parentReading
      ? await input.geometry?.(frame.frameId, viewports)
      : undefined
  if (!reading?.viewport || !parentReading || !box) {
    result.frameLimitations.push({
      frameId: frame.frameId,
      reason: reading
        ? "unmapped_or_unsupported_geometry"
        : "unavailable_document"
    })
    return
  }
  const owner = parent
    ? {
        x: (box.border.x - parent.region.x) / parent.scaleX,
        y: (box.border.y - parent.region.y) / parent.scaleY,
        width: box.border.width / parent.scaleX,
        height: box.border.height / parent.scaleY
      }
    : box.border
  const matching =
    parentReading.frameRects?.filter((candidate) =>
      sameCssRect(candidate.rect, owner)
    ) ?? []
  if (matching.length !== 1 || !matching[0].supported) {
    result.frameLimitations.push({
      frameId: frame.frameId,
      reason: "unmapped_or_unsupported_geometry"
    })
    return
  }
  const mask = parent
    ? rectThroughFrame(parent, matching[0].rect)
    : matching[0].rect
  const indices = result.rects.flatMap((rect, index) =>
    sameCssRect(rect, mask) ? [index] : []
  )
  // A coincident sensitive control or sibling is ambiguous: reveal neither.
  if (indices.length !== 1) {
    result.frameLimitations.push({
      frameId: frame.frameId,
      reason: "unmapped_or_unsupported_geometry"
    })
    return
  }
  const visual: AgentVisualFrame = {
    ...agentFrameSnapshotIdentity(input.observation, {
      frameId: frame.frameId,
      ref: ""
    }),
    parentFrameId: frame.parentFrameId ?? input.observation.frameId,
    owner,
    region: box.content,
    scaleX: box.content.width / reading.viewport.width,
    scaleY: box.content.height / reading.viewport.height,
    scroll: reading.scroll
  }
  result.rects.splice(indices[0], 1)
  result.rects.push(
    ...reading.rects.map((rect) => rectThroughFrame(visual, rect))
  )
  result.frames.push(visual)
}
