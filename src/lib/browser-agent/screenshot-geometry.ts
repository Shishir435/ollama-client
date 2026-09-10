import {
  type AgentCssRect,
  type AgentImagePoint,
  type AgentImageRect,
  type AgentScreenshot,
  MAX_AGENT_SCREENSHOT_EDGE_PX,
  MAX_AGENT_SCREENSHOT_ZOOM
} from "@ollama-client/contracts"

/**
 * Coordinate arithmetic between a screenshot and the page it pictures.
 *
 * Everything the page measures is in CSS pixels of the root frame's layout
 * viewport. Everything a vision model returns is in pixels of the image it
 * saw. Between them sit device scale, browser zoom, pinch zoom and any crop
 * the run asked for, all of which collapse into two facts recorded on the
 * screenshot: the CSS region it shows and how many image pixels one CSS pixel
 * became. Nothing else about the display is needed, and nothing here touches
 * a browser.
 */

export interface AgentCssPoint {
  x: number
  y: number
}

/** What `Page.getLayoutMetrics` reports, reduced to the two viewports. */
export interface AgentCaptureLayout {
  cssLayoutViewport: {
    pageX: number
    pageY: number
    clientWidth: number
    clientHeight: number
  }
  cssVisualViewport: {
    pageX: number
    pageY: number
    clientWidth: number
    clientHeight: number
    scale: number
  }
}

/**
 * The CSS region an unclipped capture shows. A screenshot pictures the visual
 * viewport — what pinch zoom has framed — while the page measures against the
 * layout viewport, so the region is the visual viewport expressed in layout
 * coordinates. Without pinch zoom the two coincide at the origin.
 */
export const captureRegionFor = (layout: AgentCaptureLayout): AgentCssRect => ({
  x: layout.cssVisualViewport.pageX - layout.cssLayoutViewport.pageX,
  y: layout.cssVisualViewport.pageY - layout.cssLayoutViewport.pageY,
  width: layout.cssVisualViewport.clientWidth,
  height: layout.cssVisualViewport.clientHeight
})

/** The layout viewport itself, as a rect at its own origin. */
export const layoutViewportRect = (
  layout: AgentCaptureLayout
): AgentCssRect => ({
  x: 0,
  y: 0,
  width: layout.cssLayoutViewport.clientWidth,
  height: layout.cssLayoutViewport.clientHeight
})

/**
 * The CSS point under an image pixel, or nothing when the pixel is outside
 * the image — a coordinate the model made up rather than read.
 */
export const imagePointToCss = (
  screenshot: Pick<
    AgentScreenshot,
    "region" | "scale" | "imageWidth" | "imageHeight"
  >,
  point: AgentImagePoint
): AgentCssPoint | undefined => {
  if (
    point.x < 0 ||
    point.y < 0 ||
    point.x > screenshot.imageWidth ||
    point.y > screenshot.imageHeight
  ) {
    return undefined
  }
  return {
    x: screenshot.region.x + point.x / screenshot.scale,
    y: screenshot.region.y + point.y / screenshot.scale
  }
}

const clampRect = (
  rect: AgentCssRect,
  bounds: AgentCssRect
): AgentCssRect | undefined => {
  const left = Math.max(rect.x, bounds.x)
  const top = Math.max(rect.y, bounds.y)
  const right = Math.min(rect.x + rect.width, bounds.x + bounds.width)
  const bottom = Math.min(rect.y + rect.height, bounds.y + bounds.height)
  if (right <= left || bottom <= top) return undefined
  return { x: left, y: top, width: right - left, height: bottom - top }
}

/**
 * A CSS rect as image pixels, clamped to the image and padded by one pixel on
 * every side so anti-aliased edges of what it covers cannot survive a mask.
 */
export const cssRectToImage = (
  screenshot: Pick<
    AgentScreenshot,
    "region" | "scale" | "imageWidth" | "imageHeight"
  >,
  rect: AgentCssRect
): AgentImageRect | undefined => {
  const scaled = {
    x: (rect.x - screenshot.region.x) * screenshot.scale - 1,
    y: (rect.y - screenshot.region.y) * screenshot.scale - 1,
    width: rect.width * screenshot.scale + 2,
    height: rect.height * screenshot.scale + 2
  }
  const clamped = clampRect(scaled, {
    x: 0,
    y: 0,
    width: screenshot.imageWidth,
    height: screenshot.imageHeight
  })
  if (!clamped) return undefined
  return {
    x: Math.floor(clamped.x),
    y: Math.floor(clamped.y),
    width: Math.ceil(clamped.width),
    height: Math.ceil(clamped.height)
  }
}

/** The size an image is reduced to so its longest edge fits the cap. */
export const boundedImageSize = (
  width: number,
  height: number,
  maxEdge = MAX_AGENT_SCREENSHOT_EDGE_PX
): { width: number; height: number; factor: number } => {
  const longest = Math.max(width, height)
  if (longest <= maxEdge) return { width, height, factor: 1 }
  const factor = maxEdge / longest
  return {
    width: Math.max(1, Math.round(width * factor)),
    height: Math.max(1, Math.round(height * factor)),
    factor
  }
}

/** A zoom smaller than this in CSS pixels magnifies nothing worth seeing. */
export const MIN_AGENT_ZOOM_EDGE_CSS_PX = 24

/**
 * The clip a zoom request becomes: the region of the previous image the model
 * named, as a CSS rect inside the layout viewport, and the image scale that
 * magnifies it as far as the pixel cap and the zoom cap allow. A rect that
 * leaves the viewport, or is too small to mean anything, yields nothing and
 * the run gets the whole viewport again.
 */
export const zoomClipFor = (input: {
  previous: Pick<
    AgentScreenshot,
    "region" | "scale" | "imageWidth" | "imageHeight"
  >
  zoom: AgentImageRect
  viewport: AgentCssRect
  deviceScaleFactor: number
  maxEdge?: number
}): { rect: AgentCssRect; scale: number } | undefined => {
  const maxEdge = input.maxEdge ?? MAX_AGENT_SCREENSHOT_EDGE_PX
  const topLeft = imagePointToCss(input.previous, input.zoom)
  if (!topLeft) return undefined
  const css: AgentCssRect = {
    x: topLeft.x,
    y: topLeft.y,
    width: input.zoom.width / input.previous.scale,
    height: input.zoom.height / input.previous.scale
  }
  const rect = clampRect(css, input.viewport)
  if (
    !rect ||
    rect.width < MIN_AGENT_ZOOM_EDGE_CSS_PX ||
    rect.height < MIN_AGENT_ZOOM_EDGE_CSS_PX
  ) {
    return undefined
  }
  const longest = Math.max(rect.width, rect.height)
  const scale = Math.min(
    maxEdge / longest,
    MAX_AGENT_SCREENSHOT_ZOOM * input.deviceScaleFactor
  )
  return { rect, scale }
}
