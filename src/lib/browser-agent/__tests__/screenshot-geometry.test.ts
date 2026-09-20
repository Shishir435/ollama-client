import { describe, expect, it } from "vitest"

import {
  boundedImageSize,
  captureRegionFor,
  cssRectToImage,
  imagePointToCss,
  zoomClipFor
} from "../screenshot-geometry"

const layout = {
  cssLayoutViewport: {
    pageX: 0,
    pageY: 300,
    clientWidth: 800,
    clientHeight: 600
  },
  cssVisualViewport: {
    pageX: 0,
    pageY: 300,
    clientWidth: 800,
    clientHeight: 600,
    scale: 1
  }
}

describe("screenshot geometry", () => {
  it("maps image pixels back to CSS points through device scale", () => {
    const shot = {
      region: { x: 0, y: 0, width: 800, height: 600 },
      scale: 2,
      imageWidth: 1600,
      imageHeight: 1200
    }
    expect(imagePointToCss(shot, { x: 400, y: 300 })).toEqual({
      x: 200,
      y: 150
    })
    expect(imagePointToCss(shot, { x: 1601, y: 0 })).toBeUndefined()
  })

  it("accounts for a pinch-zoomed visual viewport and a crop offset", () => {
    const pinched = {
      cssLayoutViewport: {
        pageX: 0,
        pageY: 0,
        clientWidth: 800,
        clientHeight: 600
      },
      cssVisualViewport: {
        pageX: 100,
        pageY: 50,
        clientWidth: 400,
        clientHeight: 300,
        scale: 2
      }
    }
    expect(captureRegionFor(pinched)).toEqual({
      x: 100,
      y: 50,
      width: 400,
      height: 300
    })
    /* A scrolled page moves both viewports together; the region stays at the origin. */
    expect(captureRegionFor(layout)).toEqual({
      x: 0,
      y: 0,
      width: 800,
      height: 600
    })
    const crop = {
      region: { x: 100, y: 50, width: 200, height: 100 },
      scale: 4,
      imageWidth: 800,
      imageHeight: 400
    }
    expect(imagePointToCss(crop, { x: 400, y: 200 })).toEqual({
      x: 200,
      y: 100
    })
  })

  it("masks a CSS rect in image pixels with a one-pixel margin, clamped to the image", () => {
    const shot = {
      region: { x: 0, y: 0, width: 800, height: 600 },
      scale: 2,
      imageWidth: 1600,
      imageHeight: 1200
    }
    expect(
      cssRectToImage(shot, { x: 10, y: 20, width: 100, height: 30 })
    ).toEqual({
      x: 19,
      y: 39,
      width: 202,
      height: 62
    })
    expect(
      cssRectToImage(shot, { x: 790, y: 590, width: 100, height: 100 })
    ).toEqual({
      x: 1579,
      y: 1179,
      width: 21,
      height: 21
    })
    expect(
      cssRectToImage(shot, { x: 900, y: 0, width: 10, height: 10 })
    ).toBeUndefined()
  })

  it("bounds an image by its longest edge and leaves small ones alone", () => {
    expect(boundedImageSize(2560, 1440, 1280)).toEqual({
      width: 1280,
      height: 720,
      factor: 0.5
    })
    expect(boundedImageSize(800, 600, 1280)).toEqual({
      width: 800,
      height: 600,
      factor: 1
    })
  })

  it("turns a zoom into a clamped clip magnified up to the caps, or nothing", () => {
    const previous = {
      region: { x: 0, y: 0, width: 800, height: 600 },
      scale: 1,
      imageWidth: 800,
      imageHeight: 600
    }
    const viewport = { x: 0, y: 0, width: 800, height: 600 }
    const clip = zoomClipFor({
      previous,
      zoom: { x: 100, y: 100, width: 200, height: 100 },
      viewport,
      deviceScaleFactor: 1
    })
    expect(clip).toEqual({
      rect: { x: 100, y: 100, width: 200, height: 100 },
      scale: 2
    })
    /* A tiny region is not magnified into meaning; a region off the viewport is clamped. */
    expect(
      zoomClipFor({
        previous,
        zoom: { x: 0, y: 0, width: 10, height: 10 },
        viewport,
        deviceScaleFactor: 1
      })
    ).toBeUndefined()
    expect(
      zoomClipFor({
        previous,
        zoom: { x: 700, y: 500, width: 300, height: 300 },
        viewport,
        deviceScaleFactor: 1
      })
    ).toEqual({ rect: { x: 700, y: 500, width: 100, height: 100 }, scale: 2 })
    /* On a 2× display the zoom cap is measured in device pixels. */
    expect(
      zoomClipFor({
        previous,
        zoom: { x: 0, y: 0, width: 400, height: 300 },
        viewport,
        deviceScaleFactor: 2
      })
    ).toEqual({ rect: { x: 0, y: 0, width: 400, height: 300 }, scale: 3.2 })
  })
})
