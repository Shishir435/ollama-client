import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { vectorDb } from "../db"
import { keywordIndexManager } from "../keyword-index"
import {
  ensureKeywordIndexLoaded,
  invalidateKeywordIndex
} from "../keyword-index-loader"
import { searchHybrid } from "../search"
import {
  announceVectorChange,
  onVectorChangeElsewhere,
  VECTOR_CHANGE_CHANNEL_NAME
} from "../vector-change-signal"
import { applyVectorStorageChanges } from "../vector-storage-stats"

const row = (id: number, content: string) => ({
  id,
  content,
  embedding: [1, 0],
  metadata: {
    source: "chat",
    type: "chat" as const,
    sessionId: "s-1",
    messageId: id,
    timestamp: id
  }
})

/** A second channel object stands in for another extension context. */
let otherContext: BroadcastChannel
const received: unknown[] = []
const onMessage = (event: MessageEvent) => received.push(event.data)

/** BroadcastChannel delivery is asynchronous; give it a macrotask or two. */
const delivery = () => new Promise((resolve) => setTimeout(resolve, 20))

const keywordHits = (query: string) =>
  keywordIndexManager.search(query).map((result) => result.id)

beforeEach(async () => {
  received.length = 0
  otherContext = new BroadcastChannel(VECTOR_CHANGE_CHANNEL_NAME)
  otherContext.addEventListener("message", onMessage)
  await vectorDb.vectors.clear()
  invalidateKeywordIndex()
})

afterEach(() => {
  otherContext.removeEventListener("message", onMessage)
  otherContext.close()
})

describe("vector change signal", () => {
  it("tells other contexts once a vector write commits, and never for an aborted one", async () => {
    await vectorDb.transaction(
      "rw",
      vectorDb.vectors,
      vectorDb.vectorStats,
      async () => {
        await vectorDb.vectors.add(row(1, "alpha") as never)
        await applyVectorStorageChanges(vectorDb.vectorStats, [
          { after: row(1, "alpha") as never }
        ])
        announceVectorChange()
      }
    )
    await delivery()
    expect(received).toEqual(["changed"])

    received.length = 0
    await expect(
      vectorDb.transaction(
        "rw",
        vectorDb.vectors,
        vectorDb.vectorStats,
        async () => {
          await vectorDb.vectors.add(row(2, "beta") as never)
          await applyVectorStorageChanges(vectorDb.vectorStats, [
            { after: row(2, "beta") as never }
          ])
          throw new Error("rolled back")
        }
      )
    ).rejects.toThrow("rolled back")
    await delivery()
    expect(received).toEqual([])
  })

  it("does not report a context's own writes back to it", async () => {
    let calls = 0
    const stop = onVectorChangeElsewhere(() => calls++)
    try {
      announceVectorChange()
      await delivery()
      expect(calls).toBe(0)
      otherContext.postMessage("changed")
      await delivery()
      expect(calls).toBe(1)
    } finally {
      stop()
    }
  })

  /**
   * The side panel builds its keyword index on its first search; the
   * background then indexes a new chat. Without the signal the panel's index
   * never learns of the new rows and exact-word matches for that chat are
   * missing until the panel reloads.
   */
  it("drops a searching context's keyword index when another context writes", async () => {
    await vectorDb.vectors.add(row(1, "alpha") as never)
    await ensureKeywordIndexLoaded()
    expect(keywordHits("alpha")).toEqual([1])

    /** Written by the background: this context's index is not touched. */
    await vectorDb.vectors.add(row(2, "zebra") as never)
    await ensureKeywordIndexLoaded()
    expect(keywordHits("zebra")).toEqual([])

    otherContext.postMessage("changed")
    await delivery()
    await ensureKeywordIndexLoaded()
    expect(keywordHits("zebra")).toEqual([2])
  })

  /**
   * A background write lands while this context is still building: the
   * invalidation cancels that build, which returns normally with the index
   * empty. Searches already waiting on it must wait for the replacement
   * build instead of searching what the cancelled one left.
   */
  it("waiting searches use the rebuild that replaces a build cancelled between batches", async () => {
    await vectorDb.vectors.add(row(1, "alpha") as never)
    const build = keywordIndexManager.buildFromBatches.bind(keywordIndexManager)
    let interrupted = false
    const spy = vi
      .spyOn(keywordIndexManager, "buildFromBatches")
      .mockImplementation((readBatch, onProgress) =>
        build(async (afterId) => {
          if (afterId !== undefined && !interrupted) {
            interrupted = true
            await vectorDb.vectors.add(row(2, "zebra") as never)
            otherContext.postMessage("changed")
            await delivery()
          }
          return readBatch(afterId)
        }, onProgress)
      )
    try {
      const [alpha, zebra] = await Promise.all([
        searchHybrid("alpha", [0, 1], { minSimilarity: 0.99 }),
        searchHybrid("zebra", [0, 1], { minSimilarity: 0.99 })
      ])
      expect(interrupted).toBe(true)
      expect(alpha.map((result) => result.document.id)).toEqual([1])
      expect(zebra.map((result) => result.document.id)).toEqual([2])
      /** One cancelled build and one replacement, shared by both searches. */
      expect(spy).toHaveBeenCalledTimes(2)
    } finally {
      spy.mockRestore()
    }
  })
})
