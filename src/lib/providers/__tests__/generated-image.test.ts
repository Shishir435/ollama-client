import { describe, expect, it, vi } from "vitest"
import {
  generatedImageFromBase64,
  MAX_GENERATED_IMAGE_BYTES
} from "../generated-image"

describe("generated image normalization", () => {
  it("sniffs image bytes instead of trusting provider metadata", () => {
    vi.spyOn(crypto, "randomUUID").mockReturnValue(
      "00000000-0000-4000-8000-000000000001"
    )
    const image = generatedImageFromBase64(
      "data:image/jpeg;base64,iVBORw0KGgo=",
      { providerId: "custom", model: "image-model" }
    )

    expect(image).toMatchObject({
      mimeType: "image/png",
      imageId: "generated-00000000-0000-4000-8000-000000000001",
      origin: "model-generated"
    })
  })

  it("rejects non-image and oversized provider output", () => {
    expect(
      generatedImageFromBase64(btoa("not an image"), {
        providerId: "custom",
        model: "image-model"
      })
    ).toBeNull()
    expect(
      generatedImageFromBase64(
        "A".repeat(Math.ceil(MAX_GENERATED_IMAGE_BYTES * 1.4) + 1),
        { providerId: "custom", model: "image-model" }
      )
    ).toBeNull()
  })
})
