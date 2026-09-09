import type { AgentObservation } from "@ollama-client/contracts"
import { describe, expect, it } from "vitest"

import {
  type AgentBrowserFrame,
  authorizeAgentFrame,
  composeAgentFrameObservations,
  remainingAgentElementBudget,
  selectAgentChildFrames
} from "../frame-observation"

const frameObservation = (input: {
  frameId: number
  documentId: string
  url: string
  refs: string[]
  text?: string
}): AgentObservation => {
  const origin = new URL(input.url).origin
  return {
    snapshotId: `snapshot-${input.frameId}`,
    generation: 1,
    tabId: 7,
    frameId: input.frameId,
    documentId: input.documentId,
    url: input.url,
    origin,
    title: `Frame ${input.frameId}`,
    frames: [
      {
        frameId: input.frameId,
        documentId: input.documentId,
        origin,
        url: input.url,
        access: "ok",
        snapshotId: `snapshot-${input.frameId}`,
        generation: 1
      }
    ],
    elements: input.refs.map((ref) => ({
      ref,
      frameId: input.frameId,
      tag: "button",
      name: "Continue",
      visible: true,
      enabled: true,
      editable: false,
      sensitive: false
    })),
    visibleText: input.text ?? "",
    scroll: {
      x: 0,
      y: 0,
      viewportWidth: 100,
      viewportHeight: 100,
      documentWidth: 100,
      documentHeight: 100
    },
    dialogs: [],
    capturedAt: 1
  }
}

const child = (
  frameId: number,
  url: string,
  parentFrameId = 0
): AgentBrowserFrame => ({
  frameId,
  parentFrameId,
  documentId: `document-${frameId}`,
  url
})

describe("authorizeAgentFrame", () => {
  const classify = (answer: "ok" | "restricted" | "excluded") => async () =>
    answer

  it("admits a readable frame on an origin the run may read", async () => {
    await expect(
      authorizeAgentFrame(child(2, "https://example.com/child"), {
        allowedOrigins: ["https://example.com"],
        classifyAccess: classify("ok")
      })
    ).resolves.toEqual({ origin: "https://example.com", access: "ok" })
  })

  it("refuses an origin the user never approved for this run", async () => {
    await expect(
      authorizeAgentFrame(child(2, "https://ads.example/slot"), {
        allowedOrigins: ["https://example.com"],
        classifyAccess: classify("ok")
      })
    ).resolves.toEqual({
      origin: "https://ads.example",
      access: "unauthorized_origin"
    })
  })

  it("keeps the browser's and the user's answers ahead of authorization", async () => {
    await expect(
      authorizeAgentFrame(child(2, "https://example.com/private"), {
        allowedOrigins: ["https://example.com"],
        classifyAccess: classify("excluded")
      })
    ).resolves.toMatchObject({ access: "excluded" })
  })

  it("fails closed when access cannot be classified", async () => {
    await expect(
      authorizeAgentFrame(child(2, "https://example.com/child"), {
        allowedOrigins: ["https://example.com"],
        classifyAccess: async () => {
          throw new Error("settings unavailable")
        }
      })
    ).resolves.toMatchObject({ access: "restricted" })
  })

  it("has nothing to say about a frame with no origin of its own", async () => {
    await expect(
      authorizeAgentFrame(child(2, "about:blank"), {
        allowedOrigins: ["https://example.com"],
        classifyAccess: classify("ok")
      })
    ).resolves.toBeUndefined()
  })
})

describe("selectAgentChildFrames", () => {
  it("reads the earliest frames and counts the rest", () => {
    const frames = Array.from({ length: 15 }, (_, index) =>
      child(index + 1, `https://example.com/${index + 1}`)
    ).reverse()
    const { selected, omitted } = selectAgentChildFrames([
      { frameId: 0, parentFrameId: -1, url: "https://example.com/" },
      ...frames
    ])
    expect(selected.map((frame) => frame.frameId)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11
    ])
    expect(omitted).toBe(4)
  })

  it("never lets a frame without an origin take a place or be counted", () => {
    const { selected, omitted } = selectAgentChildFrames([
      child(1, "about:blank"),
      child(2, "about:srcdoc"),
      child(3, "https://example.com/real")
    ])
    expect(selected.map((frame) => frame.frameId)).toEqual([3])
    expect(omitted).toBe(0)
  })
})

describe("composeAgentFrameObservations", () => {
  const root = frameObservation({
    frameId: 0,
    documentId: "document-0",
    url: "https://example.com/",
    refs: ["e1"],
    text: "Root text"
  })

  it("returns the root untouched when the page has no other frames", () => {
    expect(composeAgentFrameObservations({ root, children: [] })).toBe(root)
  })

  it("merges read frames and lists refused frames by origin only", () => {
    const composed = composeAgentFrameObservations({
      root,
      children: [
        {
          frame: child(2, "https://example.com/child"),
          origin: "https://example.com",
          access: "ok",
          observation: frameObservation({
            frameId: 2,
            documentId: "document-2",
            url: "https://example.com/child",
            refs: ["f2e1"],
            text: "Child text"
          })
        },
        {
          frame: child(3, "https://ads.example/slot?id=secret"),
          origin: "https://ads.example",
          access: "unauthorized_origin"
        }
      ],
      omitted: 2
    })

    expect(composed.snapshotId).toBe("snapshot-0")
    expect(composed.frames).toEqual([
      expect.objectContaining({ frameId: 0, access: "ok" }),
      expect.objectContaining({
        frameId: 2,
        parentFrameId: 0,
        access: "ok",
        snapshotId: "snapshot-2"
      }),
      {
        frameId: 3,
        parentFrameId: 0,
        documentId: "document-3",
        origin: "https://ads.example",
        access: "unauthorized_origin"
      }
    ])
    expect(composed.omittedFrames).toBe(2)
    expect(JSON.stringify(composed.frames)).not.toContain("secret")
    expect(composed.elements.map((element) => element.ref)).toEqual([
      "e1",
      "f2e1"
    ])
    expect(composed.visibleText).toBe("Root text\nChild text")
  })

  it("stays within the frame contract however many frames a page has", () => {
    const children = Array.from({ length: 11 }, (_, index) => ({
      frame: child(index + 1, `https://example.com/${index + 1}`),
      origin: "https://example.com",
      access: "unreadable" as const
    }))
    const composed = composeAgentFrameObservations({
      root,
      children,
      omitted: 30
    })
    expect(composed.frames).toHaveLength(12)
    expect(composed.omittedFrames).toBe(30)
  })

  it("lists a read frame that produced no observation as unreadable", () => {
    const composed = composeAgentFrameObservations({
      root,
      children: [
        {
          frame: child(2, "https://example.com/child"),
          origin: "https://example.com",
          access: "ok"
        }
      ]
    })
    expect(composed.frames[1]).toMatchObject({
      frameId: 2,
      access: "unreadable"
    })
    expect(composed.frames[1]?.url).toBeUndefined()
  })
})

describe("remainingAgentElementBudget", () => {
  it("hands a child what the frames before it left", () => {
    const root = frameObservation({
      frameId: 0,
      documentId: "document-0",
      url: "https://example.com/",
      refs: ["e1", "e2", "e3"]
    })
    expect(
      remainingAgentElementBudget(root, [
        {
          frame: child(2, "https://example.com/child"),
          origin: "https://example.com",
          access: "ok",
          observation: frameObservation({
            frameId: 2,
            documentId: "document-2",
            url: "https://example.com/child",
            refs: ["f2e1", "f2e2"]
          })
        }
      ])
    ).toBe(1_995)
  })
})
