import type { AgentObservation } from "@ollama-client/contracts"
import { describe, expect, it, vi } from "vitest"

import {
  type AgentImageEditor,
  type AgentRawCapture,
  createAgentScreenshotPort
} from "../screenshot-capture"

const signal = { aborted: false }

const observation = (
  overrides: Partial<AgentObservation> = {}
): AgentObservation => ({
  snapshotId: "snapshot-1",
  generation: 1,
  tabId: 7,
  frameId: 0,
  documentId: "document-1",
  url: "https://example.com/",
  origin: "https://example.com",
  title: "Example",
  frames: [
    {
      frameId: 0,
      documentId: "document-1",
      origin: "https://example.com",
      url: "https://example.com/",
      access: "ok",
      snapshotId: "snapshot-1",
      generation: 1
    }
  ],
  elements: [],
  visibleText: "",
  scroll: {
    x: 0,
    y: 120,
    viewportWidth: 800,
    viewportHeight: 600,
    documentWidth: 800,
    documentHeight: 2000
  },
  dialogs: [],
  capturedAt: 1,
  ...overrides
})

const raw = (overrides: Partial<AgentRawCapture> = {}): AgentRawCapture => ({
  data: "AAAA",
  mimeType: "image/jpeg",
  layout: {
    cssLayoutViewport: {
      pageX: 0,
      pageY: 120,
      clientWidth: 800,
      clientHeight: 600
    },
    cssVisualViewport: {
      pageX: 0,
      pageY: 120,
      clientWidth: 800,
      clientHeight: 600,
      scale: 1
    }
  },
  ...overrides
})

/** Reports a 2× image and records what it was asked to paint. */
const editor = (size = { width: 1600, height: 1200 }) => {
  const edits: unknown[] = []
  const instance: AgentImageEditor = {
    measure: vi.fn(async () => size),
    transform: vi.fn(async (_image, edit) => {
      edits.push(edit)
      return { data: "EDITED", width: edit.width, height: edit.height }
    })
  }
  return { instance, edits }
}

const sensitiveElement = {
  ref: "e1",
  frameId: 0,
  tag: "input",
  type: "password",
  visible: true,
  enabled: true,
  editable: true,
  sensitive: true
}

describe("screenshot capture pipeline", () => {
  it("binds the picture to the observation and records its geometry", async () => {
    const source = { capture: vi.fn(async () => raw()) }
    const { instance } = editor()
    const port = createAgentScreenshotPort({
      source,
      sensitive: { rects: vi.fn(async () => []) },
      editor: instance,
      now: () => 5
    })
    const shot = await port.capture(
      { runId: "run", tabId: 7, observation: observation() },
      signal
    )
    expect(shot).toMatchObject({
      snapshotId: "snapshot-1",
      generation: 1,
      documentId: "document-1",
      tabId: 7,
      capturedAt: 5,
      region: { x: 0, y: 0, width: 800, height: 600 },
      scroll: { x: 0, y: 120 },
      maskedRegions: 0,
      imageWidth: 1280,
      imageHeight: 960
    })
    /* A 1600-pixel image is over the edge cap, so it went through the editor. */
    expect(shot?.data).toBe("EDITED")
    expect(shot?.scale).toBeCloseTo(1.6)
  })

  it("paints over every sensitive control before the image leaves, in image pixels", async () => {
    const { instance, edits } = editor({ width: 800, height: 600 })
    const port = createAgentScreenshotPort({
      source: { capture: async () => raw() },
      sensitive: {
        rects: vi.fn(async (_tab, _observation, refs) => {
          expect(refs).toEqual(["e1"])
          return [{ x: 10, y: 20, width: 100, height: 30 }]
        })
      },
      editor: instance
    })
    const shot = await port.capture(
      {
        runId: "run",
        tabId: 7,
        observation: observation({ elements: [sensitiveElement] })
      },
      signal
    )
    expect(shot?.maskedRegions).toBe(1)
    expect(edits[0]).toMatchObject({
      masks: [{ x: 9, y: 19, width: 102, height: 32 }],
      mimeType: "image/jpeg"
    })
  })

  it("takes no picture when a sensitive control cannot be placed, or lives in a child frame, or no editor exists", async () => {
    const { instance } = editor({ width: 800, height: 600 })
    const unplaced = createAgentScreenshotPort({
      source: { capture: async () => raw() },
      sensitive: { rects: async () => undefined },
      editor: instance
    })
    await expect(
      unplaced.capture(
        {
          runId: "run",
          tabId: 7,
          observation: observation({ elements: [sensitiveElement] })
        },
        signal
      )
    ).resolves.toBeUndefined()

    const framed = createAgentScreenshotPort({
      source: { capture: async () => raw() },
      sensitive: { rects: async () => [] },
      editor: instance
    })
    await expect(
      framed.capture(
        {
          runId: "run",
          tabId: 7,
          observation: observation({
            frames: [
              ...observation().frames,
              {
                frameId: 3,
                parentFrameId: 0,
                documentId: "d3",
                origin: "https://embed.example",
                url: "https://embed.example/",
                access: "ok",
                snapshotId: "s3",
                generation: 1
              }
            ],
            elements: [{ ...sensitiveElement, frameId: 3, ref: "f3e1" }]
          })
        },
        signal
      )
    ).resolves.toBeUndefined()

    const noEditor = createAgentScreenshotPort({
      source: { capture: async () => raw() },
      sensitive: { rects: async () => [] }
    })
    await expect(
      noEditor.capture(
        { runId: "run", tabId: 7, observation: observation() },
        signal
      )
    ).resolves.toBeUndefined()
  })

  it("magnifies a zoom against the previous picture's geometry, scaled by the device ratio", async () => {
    const captures: unknown[] = []
    const source = {
      capture: vi.fn(async (_tab: number, clip: unknown) => {
        captures.push(clip)
        return raw()
      })
    }
    const sizes = [
      { width: 1600, height: 1200 },
      { width: 1600, height: 1200 },
      { width: 800, height: 400 }
    ]
    const instance: AgentImageEditor = {
      measure: vi.fn(async () => sizes.shift() ?? { width: 1, height: 1 }),
      transform: vi.fn(async (_image, edit) => ({
        data: "E",
        width: edit.width,
        height: edit.height
      }))
    }
    const port = createAgentScreenshotPort({
      source,
      sensitive: { rects: async () => [] },
      editor: instance
    })
    const first = await port.capture(
      { runId: "run", tabId: 7, observation: observation() },
      signal
    )
    expect(first?.zoomed).toBeUndefined()
    const zoomed = await port.capture(
      {
        runId: "run",
        tabId: 7,
        observation: observation({ snapshotId: "snapshot-2", generation: 2 }),
        /* A 400×200 region of the 1280-wide first image: 250×125 CSS pixels at (62.5, 62.5). */
        zoom: { x: 100, y: 100, width: 400, height: 200 }
      },
      signal
    )
    expect(captures).toHaveLength(3)
    expect(captures[2]).toEqual({
      rect: { x: 62.5, y: 62.5, width: 250, height: 125 },
      /* 1280/250 = 5.12 image px per CSS px caps below 2×2; divided by the device ratio of 2. */
      scale: 2
    })
    expect(zoomed).toMatchObject({
      zoomed: true,
      region: { x: 62.5, y: 62.5, width: 250, height: 125 }
    })
    /* A run the port never pictured, or one it forgot, gets the whole viewport. */
    port.forget("run")
    await port.capture(
      {
        runId: "run",
        tabId: 7,
        observation: observation(),
        zoom: { x: 0, y: 0, width: 100, height: 100 }
      },
      signal
    )
    expect(captures.at(-1)).toBeUndefined()
  })
})
