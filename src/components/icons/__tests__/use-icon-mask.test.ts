import { renderHook, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { useIconMask } from "../use-icon-mask"

/**
 * happy-dom has no canvas, so the pixel work is driven through a stub. The
 * assertions are about the decision the hook makes from the pixels — which
 * channel carries the mark — not about the browser's rasterizer.
 */
const stubCanvas = (pixels: number[] | null, size = 32) => {
  const putImageData = vi.fn()
  const toDataURL = vi.fn(() => "data:image/png;base64,MASK")
  const context = pixels
    ? {
        drawImage: vi.fn(),
        getImageData: vi.fn(() => ({
          data: Uint8ClampedArray.from(pixels),
          width: size,
          height: size
        })),
        putImageData
      }
    : null

  const canvas = {
    width: 0,
    height: 0,
    getContext: vi.fn(() => context),
    toDataURL
  }
  // Only canvas is intercepted: React needs real elements for everything else.
  const createElement = document.createElement.bind(document)
  vi.spyOn(document, "createElement").mockImplementation(((
    tag: string,
    options?: ElementCreationOptions
  ) => (tag === "canvas" ? canvas : createElement(tag, options))) as never)

  return { putImageData, toDataURL }
}

/** Every pixel identical, so the border and the interior agree. */
const solid = (r: number, g: number, b: number, a: number, size = 32) =>
  Array.from({ length: size * size }, () => [r, g, b, a]).flat()

const stubImageLoads = () => {
  class LoadedImage {
    onload: (() => void) | null = null
    onerror: (() => void) | null = null
    set src(_value: string) {
      queueMicrotask(() => this.onload?.())
    }
  }
  vi.stubGlobal("Image", LoadedImage)
}

const maskedAlpha = (putImageData: ReturnType<typeof vi.fn>): number =>
  putImageData.mock.calls[0][0].data[3]

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe("useIconMask", () => {
  it("returns nothing when there is no icon", () => {
    const { result } = renderHook(() => useIconMask(undefined))
    expect(result.current).toBeNull()
  })

  it("gives up when there is no canvas to draw on", async () => {
    stubCanvas(null)
    stubImageLoads()

    const { result } = renderHook(() => useIconMask("data:image/png;base64,A"))
    await waitFor(() => {
      expect(result.current).toBeNull()
    })
  })

  /*
   * A black tile with a white mark: grayscaling leaves a black square, so the
   * light pixels are the ones worth keeping.
   */
  it("keeps the light pixels of an opaque dark tile", async () => {
    const { putImageData, toDataURL } = stubCanvas(solid(0, 0, 0, 255))
    stubImageLoads()

    const { result } = renderHook(() => useIconMask("data:image/png;base64,B"))
    await waitFor(() => {
      expect(result.current).toBe("data:image/png;base64,MASK")
    })

    // A black border means the tile is dark, so black maps to fully cut away.
    expect(maskedAlpha(putImageData)).toBe(0)
    expect(toDataURL).toHaveBeenCalledWith("image/png")
  })

  /** A white tile with a dark mark is the same problem, mirrored. */
  it("keeps the dark pixels of an opaque light tile", async () => {
    const { putImageData } = stubCanvas(solid(255, 255, 255, 255))
    stubImageLoads()

    const { result } = renderHook(() => useIconMask("data:image/png;base64,C"))
    await waitFor(() => {
      expect(result.current).not.toBeNull()
    })

    expect(maskedAlpha(putImageData)).toBe(0)
  })

  /** Art on transparency already carries its own shape in the alpha channel. */
  it("uses the alpha channel when the icon has transparency", async () => {
    const { putImageData } = stubCanvas(solid(255, 255, 255, 0))
    stubImageLoads()

    const { result } = renderHook(() => useIconMask("data:image/png;base64,D"))
    await waitFor(() => {
      expect(result.current).not.toBeNull()
    })

    // Fully transparent pixels stay absent rather than becoming a solid block,
    // which is what inverted luminance would have made of them.
    expect(maskedAlpha(putImageData)).toBe(0)
  })

  it("builds a mask once and serves the rest from cache", async () => {
    const { toDataURL } = stubCanvas(solid(0, 0, 0, 255))
    stubImageLoads()
    const source = "data:image/png;base64,E"

    const first = renderHook(() => useIconMask(source))
    await waitFor(() => {
      expect(first.result.current).not.toBeNull()
    })

    const second = renderHook(() => useIconMask(source))
    expect(second.result.current).toBe("data:image/png;base64,MASK")
    expect(toDataURL).toHaveBeenCalledTimes(1)
  })
})
