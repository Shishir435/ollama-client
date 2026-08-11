import { useEffect, useState } from "react"

/**
 * Turn a fetched favicon into a monochrome mask, so it can be painted in
 * `currentColor` like every other glyph in the rail.
 *
 * Desaturation alone is not enough: a favicon is a picture, not a glyph, and
 * plenty of them are opaque tiles — a black square with a white mark on it
 * stays a black square once grayscaled, and reads as a blob next to outline
 * icons. What is wanted is the mark, not the tile.
 *
 * Which channel carries the mark depends on how the icon was drawn, so it is
 * measured rather than assumed:
 *
 * - **transparent art** — the alpha channel already is the mark;
 * - **opaque, dark tile** — the mark is the light pixels, so luminance is the
 *   mask;
 *   - **opaque, light tile** — the mark is the dark pixels, so inverted
 *     luminance is.
 *
 * Guessing wrong here does not produce a wrong colour, it produces a solid
 * square or an empty one, which is why the polarity is read off the icon's own
 * border instead of a default.
 */

/** Resolved masks, keyed by source. Built once per icon per session. */
const maskCache = new Map<string, string | null>()
const pending = new Map<string, Promise<string | null>>()

/** Icons render at 16-20px; a 32px mask is already more detail than is shown. */
const MASK_SIZE = 32

/** Below this, a pixel is see-through enough to count as absent. */
const OPAQUE_ALPHA = 250

/** Transparent fraction above which the alpha channel is taken as the art. */
const ALPHA_ART_RATIO = 0.1

const loadImage = (src: string): Promise<HTMLImageElement | null> =>
  new Promise((resolve) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => resolve(null)
    image.src = src
  })

const luminance = (r: number, g: number, b: number): number =>
  0.2126 * r + 0.7152 * g + 0.0722 * b

/** Mean luminance of the outermost ring — the tile, if there is one. */
const borderLuminance = (data: Uint8ClampedArray, size: number): number => {
  let total = 0
  let count = 0
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const isBorder = x === 0 || y === 0 || x === size - 1 || y === size - 1
      if (!isBorder) continue
      const index = (y * size + x) * 4
      total += luminance(data[index], data[index + 1], data[index + 2])
      count++
    }
  }
  return count > 0 ? total / count : 0
}

const buildMask = async (source: string): Promise<string | null> => {
  if (typeof document === "undefined") return null

  let canvas: HTMLCanvasElement
  let context: CanvasRenderingContext2D | null
  try {
    canvas = document.createElement("canvas")
    canvas.width = MASK_SIZE
    canvas.height = MASK_SIZE
    context = canvas.getContext("2d", { willReadFrequently: true })
  } catch {
    return null
  }
  if (!context) return null

  const image = await loadImage(source)
  if (!image) return null

  try {
    context.drawImage(image, 0, 0, MASK_SIZE, MASK_SIZE)
    const imageData = context.getImageData(0, 0, MASK_SIZE, MASK_SIZE)
    const { data } = imageData

    let transparent = 0
    for (let index = 3; index < data.length; index += 4) {
      if (data[index] < OPAQUE_ALPHA) transparent++
    }
    const isAlphaArt = transparent / (data.length / 4) > ALPHA_ART_RATIO
    const markIsLight = !isAlphaArt && borderLuminance(data, MASK_SIZE) < 128

    for (let index = 0; index < data.length; index += 4) {
      const alpha = isAlphaArt
        ? data[index + 3]
        : (() => {
            const value = luminance(
              data[index],
              data[index + 1],
              data[index + 2]
            )
            return markIsLight ? value : 255 - value
          })()
      data[index] = 0
      data[index + 1] = 0
      data[index + 2] = 0
      data[index + 3] = alpha
    }

    context.putImageData(imageData, 0, 0)
    return canvas.toDataURL("image/png")
  } catch {
    return null
  }
}

const resolveMask = (source: string): Promise<string | null> => {
  const existing = pending.get(source)
  if (existing) return existing

  const promise = buildMask(source)
    .catch(() => null)
    .then((mask) => {
      maskCache.set(source, mask)
      pending.delete(source)
      return mask
    })
  pending.set(source, promise)
  return promise
}

/**
 * The monochrome mask for a fetched icon, or `null` until one exists — which is
 * also the answer where there is no canvas to build it with. Callers fall back
 * to drawing the icon itself, so a missing mask costs appearance, not the icon.
 */
export const useIconMask = (source?: string): string | null => {
  const [mask, setMask] = useState<string | null>(() =>
    source ? (maskCache.get(source) ?? null) : null
  )

  useEffect(() => {
    if (!source) {
      setMask(null)
      return
    }
    if (maskCache.has(source)) {
      setMask(maskCache.get(source) ?? null)
      return
    }

    let active = true
    resolveMask(source).then((resolved) => {
      if (active) setMask(resolved)
    })
    return () => {
      active = false
    }
  }, [source])

  return mask
}
