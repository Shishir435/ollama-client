import { beforeEach, describe, expect, it, vi } from "vitest"
import {
  noteVectorStorageFull,
  noteVectorStorageHasRoom,
  resetVectorStorageNoticeMemory
} from "../vector-storage-full-notice"

const access = vi.hoisted(() => ({
  readSetting: vi.fn(),
  writeSetting: vi.fn()
}))

vi.mock("@/lib/storage/setting-access", () => access)

describe("vector storage notice", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetVectorStorageNoticeMemory()
  })

  it("writes once for a burst of refusals at the same limit", async () => {
    await noteVectorStorageFull(100)
    await noteVectorStorageFull(100)
    await noteVectorStorageFull(100)

    expect(access.writeSetting).toHaveBeenCalledTimes(1)
    expect(access.writeSetting.mock.calls[0][1]).toMatchObject({ limitMB: 100 })
  })

  it("does not touch storage for a store that was never full", async () => {
    access.readSetting.mockResolvedValue(null)
    await noteVectorStorageHasRoom()
    await noteVectorStorageHasRoom()

    expect(access.writeSetting).not.toHaveBeenCalled()
    expect(access.readSetting).toHaveBeenCalledTimes(1)
  })

  it("clears the marker the first time a write fits again", async () => {
    await noteVectorStorageFull(100)
    access.writeSetting.mockClear()
    await noteVectorStorageHasRoom()

    expect(access.writeSetting).toHaveBeenCalledWith(expect.anything(), null)
  })

  it("keeps the marker when storage cannot be written", async () => {
    access.writeSetting.mockRejectedValueOnce(new Error("quota"))
    await expect(noteVectorStorageFull(100)).resolves.toBeUndefined()
    await noteVectorStorageFull(100)

    expect(access.writeSetting).toHaveBeenCalledTimes(2)
  })

  it("decides from what the marker holds when its turn comes", async () => {
    await noteVectorStorageFull(100)
    access.writeSetting.mockClear()

    // A clear is still writing when a larger vector is refused at the same limit.
    let release: () => void = () => {}
    access.writeSetting.mockImplementationOnce(
      () => new Promise<void>((resolve) => (release = resolve))
    )
    const clearing = noteVectorStorageHasRoom()
    const refused = noteVectorStorageFull(100)
    await vi.waitFor(() => expect(access.writeSetting).toHaveBeenCalledTimes(1))
    release()
    await Promise.all([clearing, refused])

    expect(access.writeSetting.mock.calls.map((call) => call[1])).toEqual([
      null,
      expect.objectContaining({ limitMB: 100 })
    ])
  })

  it("reads the marker again after another context changed it", async () => {
    const listener = vi.mocked(chrome.storage.onChanged.addListener).mock
      .calls[0]?.[0] as ((changes: Record<string, unknown>) => void) | undefined
    await noteVectorStorageFull(100)
    access.writeSetting.mockClear()
    access.readSetting.mockResolvedValue({ limitMB: 100, at: 1 })

    listener?.({ "embeddings-storage-full": {} })
    await noteVectorStorageFull(100)

    expect(access.readSetting).toHaveBeenCalled()
    expect(access.writeSetting).not.toHaveBeenCalled()
  })
})
