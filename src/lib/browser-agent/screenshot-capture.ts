import type {
  AgentCancellationSignal,
  AgentScreenshotPort,
  AgentScreenshotRequest
} from "@ollama-client/agent-runtime"
import {
  type AgentCssRect,
  type AgentImageRect,
  type AgentObservation,
  type AgentScreenshot,
  AgentScreenshotSchema,
  MAX_AGENT_SCREENSHOT_EDGE_PX
} from "@ollama-client/contracts"

import {
  type AgentCaptureLayout,
  boundedImageSize,
  captureRegionFor,
  cssRectToImage,
  layoutViewportRect,
  zoomClipFor
} from "./screenshot-geometry"

/**
 * The capture pipeline, with the browser behind three small ports.
 *
 * A picture leaves the device only after every region the page itself names
 * — each sensitive control in the whole composed tree and every child frame —
 * has been painted over, only when those regions read identically before and
 * after the capture, and only at a bounded size. When any of that cannot be
 * guaranteed — the page will not answer, it moved during the capture, no
 * image editor is available — the step gets no picture rather than a picture
 * that might carry a password field.
 */

export interface AgentRawCapture {
  data: string
  mimeType: "image/jpeg" | "image/png"
  layout: AgentCaptureLayout
}

export interface AgentScreenshotSource {
  /**
   * Pictures the tab's visual viewport, or the clipped CSS region when a clip
   * is asked for; the clip's `scale` multiplies the device's own ratio.
   * `undefined` means the tab cannot be pictured right now.
   */
  capture(
    tabId: number,
    clip: { rect: AgentCssRect; scale: number } | undefined,
    signal: AgentCancellationSignal
  ): Promise<AgentRawCapture | undefined>
}

export interface AgentSensitiveRegionSource {
  /**
   * Every rect the page says a picture must cover — sensitive controls and
   * child frames, read from the whole composed tree — with the scroll they
   * were read at. `undefined` means the page could not be asked, which the
   * pipeline treats as "do not picture this page".
   */
  regions(
    tabId: number,
    observation: AgentObservation,
    signal: AgentCancellationSignal
  ): Promise<
    { rects: AgentCssRect[]; scroll: { x: number; y: number } } | undefined
  >
}

export interface AgentImageEdit {
  width: number
  height: number
  masks: readonly AgentImageRect[]
  mimeType: "image/jpeg"
  quality: number
}

export interface AgentImageEditor {
  /** The encoded image's own pixel size. */
  measure(image: {
    data: string
    mimeType: string
  }): Promise<{ width: number; height: number }>
  /** Re-encodes the image at the given size with the masks painted opaque. */
  transform(
    image: { data: string; mimeType: string },
    edit: AgentImageEdit
  ): Promise<{ data: string; width: number; height: number }>
}

export const AGENT_SCREENSHOT_JPEG_QUALITY = 0.72

const sameRegions = (
  first: { rects: AgentCssRect[]; scroll: { x: number; y: number } },
  second: { rects: AgentCssRect[]; scroll: { x: number; y: number } }
): boolean => JSON.stringify(first) === JSON.stringify(second)

/**
 * Assembles the pipeline. The previous capture's geometry is remembered per
 * run, in memory only, so a zoom the model asks for in that image's pixels can
 * be converted; a worker restart forgets it and the next capture is the whole
 * viewport, which the model can zoom again.
 */
export const createAgentScreenshotPort = (input: {
  source: AgentScreenshotSource
  sensitive: AgentSensitiveRegionSource
  editor?: AgentImageEditor
  now?: () => number
  maxEdge?: number
}): AgentScreenshotPort & { forget(runId: string): void } => {
  const now = input.now ?? (() => Date.now())
  const maxEdge = input.maxEdge ?? MAX_AGENT_SCREENSHOT_EDGE_PX
  const previous = new Map<string, AgentScreenshot>()

  /**
   * The regions to paint, read from the whole page at the observation's own
   * scroll position. A page that scrolled since the observation is a picture
   * of something else; a page that will not answer is not pictured.
   */
  const maskRegions = async (
    request: AgentScreenshotRequest,
    signal: AgentCancellationSignal
  ) => {
    const regions = await input.sensitive.regions(
      request.tabId,
      request.observation,
      signal
    )
    if (
      !regions ||
      regions.scroll.x !== request.observation.scroll.x ||
      regions.scroll.y !== request.observation.scroll.y
    ) {
      return undefined
    }
    return regions
  }

  const clipFor = (
    request: AgentScreenshotRequest,
    layout: AgentCaptureLayout,
    deviceScaleFactor: number
  ) => {
    const last = previous.get(request.runId)
    if (!request.zoom || !last) return undefined
    return zoomClipFor({
      previous: last,
      zoom: request.zoom,
      viewport: layoutViewportRect(layout),
      deviceScaleFactor,
      maxEdge
    })
  }

  const capture = async (
    request: AgentScreenshotRequest,
    signal: AgentCancellationSignal
  ): Promise<AgentScreenshot | undefined> => {
    /* No editor means no masking and no measuring, so no picture. */
    const editor = input.editor
    if (!editor) return undefined
    const before = await maskRegions(request, signal)
    if (!before) return undefined
    if (signal.aborted) return undefined

    /*
     * A zoom needs the current layout and device scale to clamp and magnify
     * against, which only a capture reports; the first capture answers that
     * and a zoomed one follows. Two captures for a zoom is the price of never
     * guessing the viewport.
     */
    let raw = await input.source.capture(request.tabId, undefined, signal)
    if (!raw) return undefined
    let size = await editor.measure(raw)
    let region = captureRegionFor(raw.layout)
    const deviceScaleFactor = size.width / region.width
    let zoomed = false
    const clip = clipFor(request, raw.layout, deviceScaleFactor)
    if (clip) {
      /* The source scales relative to the device ratio, which is already in the capture. */
      const magnified = await input.source.capture(
        request.tabId,
        { rect: clip.rect, scale: clip.scale / deviceScaleFactor },
        signal
      )
      if (magnified) {
        raw = magnified
        size = await editor.measure(raw)
        region = clip.rect
        zoomed = true
      }
    }
    if (signal.aborted) return undefined
    /**
     * Read again after the capture. Masks placed before it cover what the
     * picture shows only if nothing moved in between; a page that scrolled,
     * re-laid out or gained a control while the picture was taken is not
     * pictured this step.
     */
    const after = await maskRegions(request, signal)
    if (!after || !sameRegions(before, after)) return undefined

    const geometry = {
      region,
      scale: size.width / region.width,
      imageWidth: size.width,
      imageHeight: size.height
    }
    const imageMasks = before.rects
      .map((rect) => cssRectToImage(geometry, rect))
      .filter((rect): rect is AgentImageRect => rect !== undefined)
    const bounded = boundedImageSize(size.width, size.height, maxEdge)
    const needsEdit =
      imageMasks.length > 0 ||
      bounded.factor !== 1 ||
      raw.mimeType !== "image/jpeg"

    let data = raw.data
    let width = size.width
    let height = size.height
    if (needsEdit) {
      const edited = await editor.transform(
        { data: raw.data, mimeType: raw.mimeType },
        {
          width: bounded.width,
          height: bounded.height,
          masks: imageMasks.map((rect) => ({
            x: Math.floor(rect.x * bounded.factor),
            y: Math.floor(rect.y * bounded.factor),
            width: Math.ceil(rect.width * bounded.factor),
            height: Math.ceil(rect.height * bounded.factor)
          })),
          mimeType: "image/jpeg",
          quality: AGENT_SCREENSHOT_JPEG_QUALITY
        }
      )
      data = edited.data
      width = edited.width
      height = edited.height
    }

    const candidate = {
      snapshotId: request.observation.snapshotId,
      generation: request.observation.generation,
      tabId: request.observation.tabId,
      frameId: request.observation.frameId,
      documentId: request.observation.documentId,
      capturedAt: now(),
      mimeType: "image/jpeg" as const,
      data,
      imageWidth: width,
      imageHeight: height,
      region,
      scale: width / region.width,
      scroll: {
        x: request.observation.scroll.x,
        y: request.observation.scroll.y
      },
      maskedRegions: imageMasks.length,
      ...(zoomed ? { zoomed: true } : {})
    }
    const parsed = AgentScreenshotSchema.safeParse(candidate)
    if (!parsed.success) return undefined
    previous.set(request.runId, parsed.data)
    return parsed.data
  }

  return {
    capture,
    forget(runId) {
      previous.delete(runId)
    }
  }
}
