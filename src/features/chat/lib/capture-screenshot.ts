import { browser } from "@/lib/browser-api"
import { base64ToBytes, stripDataUrlPrefix } from "@/lib/image-utils"

/**
 * Capture the visible area of the active tab as a PNG `File` (E1 / 0.11.5),
 * ready to stage through the normal image-attachment pipeline.
 *
 * Throws when the page can't be captured — restricted pages (`chrome://`, the
 * Web Store, the extension's own pages) reject `captureVisibleTab`. Callers
 * should surface that to the user.
 */
export const captureVisibleTabPng = async (
  timestamp: number = Date.now()
): Promise<File> => {
  const win = await browser.windows.getCurrent()
  const dataUrl = await browser.tabs.captureVisibleTab(win.id, {
    format: "png"
  })
  if (!dataUrl) throw new Error("Screenshot capture returned no data")

  // `as BlobPart`: base64ToBytes returns Uint8Array<ArrayBufferLike>, which the
  // DOM lib's BlobPart only accepts when narrowed to a plain ArrayBuffer.
  const bytes = base64ToBytes(stripDataUrlPrefix(dataUrl)) as BlobPart
  return new File([bytes], `screenshot-${timestamp}.png`, {
    type: "image/png"
  })
}
