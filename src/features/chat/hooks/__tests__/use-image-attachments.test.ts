import { act, renderHook } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { useImageAttachments } from "../use-image-attachments"

const file = (name: string, type: string, contents = "abc"): File =>
  new File([contents], name, { type })

describe("useImageAttachments", () => {
  const onReject = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it.each([
    [file("photo.heic", "image/jpeg"), "heic"],
    [file("photo.jpg", "image/heic"), "heic"],
    [file("notes.txt", "text/plain"), "type"]
  ] as const)("rejects %s as %s", async (input, reason) => {
    const { result } = renderHook(() =>
      useImageAttachments({ maxSizeBytes: 100, onReject })
    )

    await expect(result.current.fileToAttachment(input)).resolves.toBeNull()
    expect(onReject).toHaveBeenCalledWith(reason, input)
  })

  it("rejects an image above the configured byte limit", async () => {
    const input = file("large.png", "image/png", "12345")
    const { result } = renderHook(() =>
      useImageAttachments({ maxSizeBytes: 4, onReject })
    )

    await expect(result.current.fileToAttachment(input)).resolves.toBeNull()
    expect(onReject).toHaveBeenCalledWith("size", input)
  })

  it("silently rejects when notification is disabled", async () => {
    const input = file("notes.txt", "text/plain")
    const { result } = renderHook(() =>
      useImageAttachments({ maxSizeBytes: 100, onReject })
    )

    await expect(
      result.current.fileToAttachment(input, false)
    ).resolves.toBeNull()
    expect(onReject).not.toHaveBeenCalled()
  })

  it("converts an accepted image to a base64 attachment", async () => {
    const input = file("photo.png", "image/png")
    const { result } = renderHook(() =>
      useImageAttachments({ maxSizeBytes: 100, onReject })
    )

    await expect(result.current.fileToAttachment(input)).resolves.toMatchObject(
      {
        imageId: expect.stringMatching(/^img-/),
        fileName: "photo.png",
        mimeType: "image/png",
        size: 3,
        base64: "YWJj"
      }
    )
    expect(onReject).not.toHaveBeenCalled()
  })

  it("stages only accepted files", async () => {
    const accepted = file("photo.png", "image/png")
    const rejected = file("notes.txt", "text/plain")
    const { result } = renderHook(() =>
      useImageAttachments({ maxSizeBytes: 100, onReject })
    )

    await act(async () => {
      await result.current.addFiles([accepted, rejected])
    })

    expect(result.current.images).toHaveLength(1)
    expect(result.current.images[0]).toMatchObject({ fileName: "photo.png" })
    expect(onReject).toHaveBeenCalledWith("type", rejected)
  })

  it("removes one image and clears the remainder", async () => {
    const { result } = renderHook(() =>
      useImageAttachments({ maxSizeBytes: 100, onReject })
    )
    await act(async () => {
      await result.current.addFiles([
        file("one.png", "image/png"),
        file("two.png", "image/png")
      ])
    })
    const firstId = result.current.images[0].imageId

    act(() => result.current.remove(firstId))
    expect(result.current.images.map((image) => image.fileName)).toEqual([
      "two.png"
    ])

    act(() => result.current.clear())
    expect(result.current.images).toEqual([])
  })
})
