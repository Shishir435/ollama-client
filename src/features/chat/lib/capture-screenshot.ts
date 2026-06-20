import { browser } from "@/lib/browser-api"
import { base64ToBytes, stripDataUrlPrefix } from "@/lib/image-utils"

/** Keep the lossless PNG when it's at or under this size (crisper text for the
 * model); above it, re-capture as JPEG so a HiDPI/4K frame stays under the cap. */
const PNG_KEEP_BYTES = 1_500_000
/** JPEG quality (0–100) for the large-capture fallback. */
const SCREENSHOT_JPEG_QUALITY = 80

const dataUrlToBytes = (dataUrl: string) =>
  // `as BlobPart`: base64ToBytes returns Uint8Array<ArrayBufferLike>, which the
  // DOM lib's BlobPart only accepts when narrowed to a plain ArrayBuffer.
  base64ToBytes(stripDataUrlPrefix(dataUrl)) as BlobPart & {
    byteLength: number
  }

/**
 * Capture the visible area of the active tab as an image `File` (E1 / 0.11.5),
 * ready to stage through the normal image-attachment pipeline.
 *
 * Format is chosen by the actual captured size, not the screen: small captures
 * stay lossless PNG (crisper text); large ones (HiDPI/Retina frames are
 * `viewport × devicePixelRatio`, easily ~4K and many MB as PNG) re-capture as
 * JPEG so they stay under the image-size cap. We can't predict this up front —
 * the sidepanel's own window size isn't the captured tab's viewport.
 *
 * Throws when the page can't be captured — restricted pages (`chrome://`, the
 * Web Store, the extension's own pages) reject `captureVisibleTab`. Callers
 * should surface that to the user.
 */
export const captureVisibleTabImage = async (
  timestamp: number = Date.now(),
  pngKeepBytes: number = PNG_KEEP_BYTES
): Promise<File> => {
  const win = await browser.windows.getCurrent()
  if (win.id === undefined) {
    // Without an explicit id, captureVisibleTab would silently fall back to the
    // last-focused window — defeating the point of pinning to this window.
    throw new Error("Could not resolve the current window to capture")
  }

  const pngUrl = await browser.tabs.captureVisibleTab(win.id, { format: "png" })
  if (!pngUrl) throw new Error("Screenshot capture returned no data")

  const pngBytes = dataUrlToBytes(pngUrl)
  if (pngBytes.byteLength <= pngKeepBytes) {
    return new File([pngBytes], `screenshot-${timestamp}.png`, {
      type: "image/png"
    })
  }

  // Too big as PNG — re-capture compressed.
  const jpegUrl = await browser.tabs.captureVisibleTab(win.id, {
    format: "jpeg",
    quality: SCREENSHOT_JPEG_QUALITY
  })
  if (!jpegUrl) throw new Error("Screenshot capture returned no data")
  return new File([dataUrlToBytes(jpegUrl)], `screenshot-${timestamp}.jpg`, {
    type: "image/jpeg"
  })
}
