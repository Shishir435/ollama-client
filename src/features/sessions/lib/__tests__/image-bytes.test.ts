import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({ getFileDataByRowIds: vi.fn() }))

vi.mock("@/lib/repositories/chat-history", () => ({
  getFileDataByRowIds: mocks.getFileDataByRowIds
}))

import type { ChatMessage } from "@/types"
import {
  clearImageBytesCache,
  hydrateMessageImages,
  loadImageBytes
} from "../image-bytes"

const reference = (id: number) => ({
  id,
  imageId: `image-${id}`,
  fileName: `${id}.png`,
  mimeType: "image/png",
  size: 3,
  base64: ""
})

describe("image bytes", () => {
  beforeEach(() => {
    clearImageBytesCache()
    vi.clearAllMocks()
  })

  it("fills only the images that are references, in one read", async () => {
    mocks.getFileDataByRowIds.mockResolvedValue(
      new Map([
        [1, new Uint8Array([1, 2, 3])],
        [2, new Uint8Array([4, 5, 6])]
      ])
    )
    const loaded = { ...reference(9), base64: "AAAA" }
    const messages: ChatMessage[] = [
      { role: "user", content: "a", images: [reference(1), loaded] },
      { role: "user", content: "b", images: [reference(2)] },
      { role: "assistant", content: "c" }
    ]

    const result = await hydrateMessageImages(messages)

    expect(mocks.getFileDataByRowIds).toHaveBeenCalledOnce()
    expect(mocks.getFileDataByRowIds).toHaveBeenCalledWith([1, 2])
    expect(result[0]?.images?.map((image) => image.base64)).toEqual([
      "AQID",
      "AAAA"
    ])
    expect(result[1]?.images?.[0]?.base64).toBe("BAUG")
    expect(result[2]).toBe(messages[2])
  })

  it("returns the same array when nothing needs reading", async () => {
    const messages: ChatMessage[] = [{ role: "user", content: "a" }]
    expect(await hydrateMessageImages(messages)).toBe(messages)
    expect(mocks.getFileDataByRowIds).not.toHaveBeenCalled()
  })

  it("fails loudly when stored bytes are gone instead of sending an empty image", async () => {
    mocks.getFileDataByRowIds.mockResolvedValue(new Map())
    await expect(
      hydrateMessageImages([
        { role: "user", content: "a", images: [reference(1)] }
      ])
    ).rejects.toThrow(/gone/)
  })

  it("serves a repeated read from memory and shares a read in flight", async () => {
    let resolve: ((value: Map<number, Uint8Array>) => void) | undefined
    mocks.getFileDataByRowIds.mockImplementation(
      () => new Promise((done) => (resolve = done))
    )
    const first = loadImageBytes(1)
    const second = loadImageBytes(1)
    resolve?.(new Map([[1, new Uint8Array([1])]]))
    await Promise.all([first, second])
    await loadImageBytes(1)

    expect(mocks.getFileDataByRowIds).toHaveBeenCalledOnce()
  })

  it("evicts the oldest bytes past the memory limit", async () => {
    const big = new Uint8Array(30 * 1024 * 1024)
    mocks.getFileDataByRowIds.mockImplementation(
      async (ids: number[]) => new Map(ids.map((id) => [id, big]))
    )
    await loadImageBytes(1)
    await loadImageBytes(2)
    await loadImageBytes(1)

    expect(mocks.getFileDataByRowIds).toHaveBeenCalledTimes(3)
  })
})
