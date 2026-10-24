import { beforeEach, describe, expect, it, vi } from "vitest"
import { getPlasmoStoredValue } from "@/lib/plasmo-global-storage"
import { vectorDb } from "../db"
import {
  activateMessageRevision,
  fenceMessageVectors
} from "../message-revisions"
import { searchSimilarVectors } from "../search"
import { storeVector, deleteVectors, clearAllVectors } from "../storage"

const metadata = {
  type: "chat" as const,
  source: "chat",
  sessionId: "chat",
  messageId: 1,
  messageRevision: "revision-1",
  timestamp: 1,
  embeddingModel: "test",
  embeddingProviderId: "ollama",
  embeddingDim: 2
}
describe("message chunk revisions", () => {
  beforeEach(async () => {
    await vectorDb.vectors.clear()
    await vectorDb.deletedSessions.clear()
    await vectorDb.messageState.clear()
    vi.mocked(getPlasmoStoredValue).mockResolvedValue(undefined)
    await activateMessageRevision(1, "revision-1")
  })
  it("keeps every chunk while repeated writes are idempotent", async () => {
    const first = await storeVector("first chunk", [1, 0], {
      ...metadata,
      chunkIndex: 0
    })
    const last = await storeVector("TAIL-CANARY", [0, 1], {
      ...metadata,
      chunkIndex: 1
    })
    expect(first).toBeGreaterThan(0)
    expect(last).not.toBe(first)
    expect(
      await storeVector("first chunk", [1, 0], { ...metadata, chunkIndex: 0 })
    ).toBe(first)
    expect(await vectorDb.vectors.count()).toBe(2)
    expect((await vectorDb.vectors.get(last))?.content).toBe("TAIL-CANARY")
    const retrieved = await searchSimilarVectors([0, 1], {
      type: "chat",
      sessionId: "chat",
      embeddingModel: "test",
      embeddingProviderId: "ollama",
      minSimilarity: 0.9,
      limit: 1
    })
    expect(retrieved[0].document.content).toBe("TAIL-CANARY")
  })
  it("fences a held embedding even after deletion cleanup finished", async () => {
    let release!: () => void
    const held = new Promise<void>((resolve) => {
      release = resolve
    })
    const writer = held.then(() =>
      storeVector("DELETED-CANARY", [1, 0], metadata)
    )
    await deleteVectors({ messageId: 1 })
    release()
    expect(await writer).toBe(0)
    expect(await vectorDb.vectors.count()).toBe(0)
  })
  it("fences a session even before its first vector has been written", async () => {
    await deleteVectors({ sessionId: "chat", type: "chat" })
    expect(await storeVector("late first chunk", [1, 0], metadata)).toBe(0)
  })
  it("does not return a deleted message from an already populated search cache", async () => {
    const options = {
      type: "chat" as const,
      sessionId: "chat",
      embeddingModel: "test",
      embeddingProviderId: "ollama",
      minSimilarity: 0.9,
      limit: 1
    }
    await storeVector("CACHED-CANARY", [1, 0], metadata)
    expect(await searchSimilarVectors([1, 0], options)).toHaveLength(1)
    await deleteVectors({ messageId: 1 })
    expect(await searchSimilarVectors([1, 0], options)).toEqual([])
  })
  it("fences pending messages when the user clears all memory", async () => {
    await clearAllVectors("chat")
    expect(await storeVector("late first chunk", [1, 0], metadata)).toBe(0)
  })
  it("removes the old revision and refuses its late chunks after editing", async () => {
    await storeVector("old content", [1, 0], metadata)
    const token = (await fenceMessageVectors([1])).get(1)!
    await activateMessageRevision(1, "revision-2", token)
    expect(
      await storeVector("old tail", [1, 0], { ...metadata, chunkIndex: 1 })
    ).toBe(0)
    expect(
      await storeVector("new content", [0, 1], {
        ...metadata,
        messageRevision: "revision-2"
      })
    ).toBeGreaterThan(0)
    expect(
      (await vectorDb.vectors.toArray()).map((doc) => doc.content)
    ).toEqual(["new content"])
  })
})
