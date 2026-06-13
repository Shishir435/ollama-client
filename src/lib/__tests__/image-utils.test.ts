import { describe, expect, it } from "vitest"

import {
  base64ToBytes,
  bytesToBase64,
  imageToStoredFile,
  isImageFile,
  storedFileToImage,
  stripDataUrlPrefix,
  toDataUrl
} from "@/lib/image-utils"
import type { ImageAttachment } from "@/types"

const sampleBase64 = "aGVsbG8gd29ybGQ=" // "hello world"

describe("image-utils", () => {
  it("round-trips base64 <-> bytes", () => {
    const bytes = base64ToBytes(sampleBase64)
    expect(bytesToBase64(bytes)).toBe(sampleBase64)
  })

  it("builds and strips data URLs", () => {
    const url = toDataUrl("image/png", sampleBase64)
    expect(url).toBe(`data:image/png;base64,${sampleBase64}`)
    expect(stripDataUrlPrefix(url)).toBe(sampleBase64)
    expect(stripDataUrlPrefix(sampleBase64)).toBe(sampleBase64)
  })

  it("round-trips an image through stored-file conversion", () => {
    const image: ImageAttachment = {
      imageId: "img-1",
      fileName: "shot.png",
      mimeType: "image/png",
      size: 11,
      base64: sampleBase64
    }
    const stored = imageToStoredFile(image, 42, "session-1")

    expect(stored).toMatchObject({
      fileId: "img-1",
      fileType: "image/png",
      fileSize: 11,
      messageId: 42,
      sessionId: "session-1"
    })
    expect(stored.data).toBeInstanceOf(Uint8Array)
    expect(isImageFile(stored)).toBe(true)

    const restored = storedFileToImage(stored)
    expect(restored.base64).toBe(sampleBase64)
    expect(restored.imageId).toBe("img-1")
    expect(restored.mimeType).toBe("image/png")
  })

  it("does not classify non-image files as images", () => {
    expect(
      isImageFile({
        fileId: "f",
        fileName: "a.pdf",
        fileType: "application/pdf",
        fileSize: 1,
        processedAt: 0
      })
    ).toBe(false)
  })
})
