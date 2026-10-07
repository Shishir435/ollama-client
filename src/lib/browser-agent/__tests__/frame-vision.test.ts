import type {
  AgentObservation,
  AgentSnapshotIdentity,
  AgentVisualFrame
} from "@ollama-client/contracts"
import { describe, expect, it, vi } from "vitest"
import type { AgentSensitiveRegions } from "../control-port"
import {
  collectAgentVisualRegions,
  hitTestAgentVisualPoint
} from "../frame-vision"
import { axisAlignedQuad } from "../screenshot-geometry"

const root: AgentSnapshotIdentity = {
  snapshotId: "root",
  generation: 1,
  documentId: "d0",
  frameId: 0,
  tabId: 7
}
const owner = { x: 100, y: 80, width: 400, height: 300 }
const secret = { x: 20, y: 30, width: 100, height: 20 }
const observation = (): AgentObservation => ({
  ...root,
  url: "https://example.com",
  origin: "https://example.com",
  title: "",
  elements: [],
  visibleText: "",
  scroll: {
    x: 0,
    y: 0,
    viewportWidth: 800,
    viewportHeight: 600,
    documentWidth: 800,
    documentHeight: 1000
  },
  dialogs: [],
  capturedAt: 1,
  frames: [
    { ...root, access: "ok", origin: "https://example.com" },
    {
      frameId: 2,
      parentFrameId: 0,
      documentId: "d2",
      snapshotId: "child",
      generation: 1,
      access: "ok",
      origin: "https://example.com"
    },
    {
      frameId: 3,
      parentFrameId: 0,
      access: "unauthorized_origin",
      origin: "https://secret.example"
    }
  ]
})
const childMask = { x: 550, y: 80, width: 200, height: 200 }
const readings = (): Record<number, AgentSensitiveRegions> => ({
  0: {
    rects: [owner, childMask],
    frameRects: [
      { rect: owner, supported: true },
      { rect: childMask, supported: true }
    ],
    viewport: { width: 800, height: 600 },
    scroll: { x: 0, y: 0 }
  },
  2: {
    rects: [secret],
    frameRects: [],
    viewport: { width: 200, height: 150 },
    scroll: { x: 0, y: 50 }
  }
})
const harness = () => {
  const data = readings()
  const regions = vi.fn(
    async (identity: AgentSnapshotIdentity) => data[identity.frameId] ?? null
  )
  const geometry = vi.fn(async () => ({ content: owner, border: owner }))
  return {
    data,
    regions,
    geometry,
    collect: () =>
      collectAgentVisualRegions({
        observation: observation(),
        regions,
        geometry
      })
  }
}

describe("authorized frame vision", () => {
  it("reveals the authorized document, scales its sensitive masks, and never requests an unauthorized frame", async () => {
    const h = harness()
    const result = await h.collect()
    expect(result?.rects).toEqual([
      childMask,
      { x: 140, y: 140, width: 200, height: 40 }
    ])
    expect(result?.frames[0]).toMatchObject({
      frameId: 2,
      documentId: "d2",
      snapshotId: "child",
      scaleX: 2,
      scaleY: 2,
      scroll: { x: 0, y: 50 }
    })
    expect(h.regions.mock.calls.map(([identity]) => identity.frameId)).toEqual([
      0, 2
    ])
  })
  it.each([
    "missing",
    "unsupported",
    "coincident"
  ])("keeps a %s owner fully masked", async (kind) => {
    const h = harness()
    if (kind === "missing") h.data[2] = null
    const rootReading = h.data[0]
    if (!rootReading?.frameRects) throw new Error("root missing")
    if (kind === "unsupported") rootReading.frameRects[0].supported = false
    if (kind === "coincident") rootReading.rects.push(owner)
    const result = await h.collect()
    expect(result?.rects).toContainEqual(owner)
    expect(result?.frames).toEqual([])
    expect(result?.frameLimitations).toHaveLength(1)
  })
  it("keeps legacy captures fully masked when exact geometry is unavailable", async () => {
    const h = harness()
    expect(
      (
        await collectAgentVisualRegions({
          observation: observation(),
          regions: h.regions
        })
      )?.rects
    ).toEqual([owner, childMask])
    expect(h.regions).toHaveBeenCalledTimes(1)
  })
  it("follows a nested owner chain and sends frame-local points to each document", async () => {
    const outer: AgentVisualFrame = {
      ...root,
      frameId: 2,
      snapshotId: "outer",
      documentId: "d2",
      parentFrameId: 0,
      owner,
      region: owner,
      scaleX: 2,
      scaleY: 2,
      scroll: { x: 0, y: 50 }
    }
    const inner: AgentVisualFrame = {
      ...outer,
      frameId: 4,
      snapshotId: "inner",
      documentId: "d4",
      parentFrameId: 2,
      owner: { x: 10, y: 10, width: 50, height: 50 },
      region: { x: 120, y: 100, width: 100, height: 100 },
      scaleX: 1,
      scaleY: 1
    }
    const hitTest = vi.fn(async (identity: AgentSnapshotIdentity) =>
      identity.frameId === 0
        ? { frameElement: true, frameRect: owner }
        : identity.frameId === 2
          ? { frameElement: true, frameRect: inner.owner }
          : {
              element: {
                ref: "f4e1",
                frameId: 4,
                tag: "canvas",
                visible: true,
                enabled: true,
                editable: false,
                sensitive: false
              }
            }
    )
    const result = await hitTestAgentVisualPoint({
      root,
      frames: [outer, inner],
      point: { x: 150, y: 130 },
      hitTest
    })
    expect(hitTest.mock.calls.map(([identity]) => identity.frameId)).toEqual([
      0, 2, 4
    ])
    expect(hitTest).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ frameId: 2 }),
      { x: 25, y: 25 }
    )
    expect(hitTest).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({ frameId: 4 }),
      { x: 30, y: 30 }
    )
    expect(result.path).toEqual([outer, inner])
  })
  it("never chooses between coincident siblings and never descends into an unlisted owner", async () => {
    const visual: AgentVisualFrame = {
      ...root,
      frameId: 2,
      parentFrameId: 0,
      owner,
      region: owner,
      scaleX: 1,
      scaleY: 1,
      scroll: { x: 0, y: 0 }
    }
    for (const frames of [[], [visual, { ...visual, frameId: 3 }]]) {
      const hitTest = vi.fn(async () => ({
        frameElement: true,
        frameRect: owner
      }))
      const result = await hitTestAgentVisualPoint({
        root,
        frames,
        point: { x: 150, y: 130 },
        hitTest
      })
      expect(result.path).toEqual([])
      expect(hitTest).toHaveBeenCalledTimes(1)
    }
  })
  it("accepts positive axis scaling and refuses rotation, skew, reflection and malformed quads", () => {
    expect(axisAlignedQuad([10, 20, 110, 20, 110, 70, 10, 70])).toEqual({
      x: 10,
      y: 20,
      width: 100,
      height: 50
    })
    for (const quad of [
      [0, 0, 100, 10, 100, 50, 0, 40],
      [100, 0, 0, 0, 0, 50, 100, 50],
      [0, 0, NaN, 0, 100, 50, 0, 50],
      [0, 0]
    ])
      expect(axisAlignedQuad(quad)).toBeUndefined()
  })
})
