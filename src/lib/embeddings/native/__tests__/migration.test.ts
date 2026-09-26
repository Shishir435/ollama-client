import { beforeEach, describe, expect, it, vi } from "vitest"
import {
  getPlasmoStoredValue,
  setPlasmoStoredValue
} from "@/lib/plasmo-global-storage"
import { vectorDb } from "../../db"
import { storeVector } from "../../storage"
import { BUNDLED_MODEL } from "../constants"
import { nativeEmbeddingCommand, nativeEmbeddingStatus } from "../migration"
import { initializeBundledInstall, readNativeIndexState } from "../state"

const { embed } = vi.hoisted(() => ({ embed: vi.fn() }))
vi.mock("../client", () => ({ generateBundledEmbedding: embed }))
const source = (id: number, type: "file" | "chat" | "webpage" = "file") => ({
  id,
  content: `saved content ${id}`,
  embedding: [1, 0],
  metadata: {
    type,
    source: "test",
    timestamp: 1,
    embeddingModel: "old",
    embeddingProviderId: "ollama",
    fileId: `file-${id}`
  }
})
const vector = () => Array.from({ length: 384 }, (_, i) => (i === 0 ? 1 : 0))

beforeEach(async () => {
  const settings = new Map<string, unknown>()
  vi.mocked(getPlasmoStoredValue).mockImplementation(
    async (key) => settings.get(key) as never
  )
  vi.mocked(setPlasmoStoredValue).mockImplementation(async (key, value) => {
    settings.set(key, value)
  })
  await vectorDb.vectors.clear()
  await vectorDb.embeddingState.clear()
  await vectorDb.embeddingRebuild.clear()
  embed.mockReset().mockImplementation(async () => vector())
})

describe("bundled embedding migration", () => {
  it("rejects late writes from the previous provider after committing the native index", async () => {
    await vectorDb.vectors.add(source(1))
    await nativeEmbeddingCommand("start")
    const staging = await vectorDb.embeddingRebuild.toArray()
    expect(JSON.stringify(staging)).not.toContain("saved content")
    await nativeEmbeddingCommand("step")
    await expect(
      storeVector("late external chunk", [1, 0], source(2).metadata)
    ).rejects.toThrow("selection changed")
    expect(await vectorDb.vectors.count()).toBe(1)
  })
  it("preserves upgrades and opts in only an empty new install", async () => {
    expect((await nativeEmbeddingStatus()).mode).toBe("external")
    await vectorDb.vectors.add(source(1))
    await initializeBundledInstall()
    expect((await nativeEmbeddingStatus()).mode).toBe("external")
    await vectorDb.vectors.clear()
    await initializeBundledInstall()
    expect((await nativeEmbeddingStatus()).mode).toBe("bundled")
  })
  it("keeps originals active through batches, then commits files, pages and chats together", async () => {
    await vectorDb.vectors.bulkAdd(
      Array.from({ length: 10 }, (_, i) =>
        source(i + 1, i % 3 === 0 ? "webpage" : i % 3 === 1 ? "chat" : "file")
      )
    )
    const originals = await vectorDb.vectors.toArray()
    await nativeEmbeddingCommand("start")
    await nativeEmbeddingCommand("step")
    expect((await nativeEmbeddingStatus()).current).toBe(8)
    expect((await nativeEmbeddingStatus()).mode).toBe("external")
    expect(await vectorDb.vectors.toArray()).toEqual(originals)
    await nativeEmbeddingCommand("step")
    expect((await nativeEmbeddingStatus()).mode).toBe("bundled")
    const migrated = await vectorDb.vectors.toArray()
    expect(migrated.map((doc) => doc.content)).toEqual(
      originals.map((doc) => doc.content)
    )
    expect(
      migrated.every(
        (doc) =>
          doc.metadata.embeddingModel === BUNDLED_MODEL &&
          doc.embedding.length === 384
      )
    ).toBe(true)
    expect(await vectorDb.embeddingRebuild.count()).toBe(0)
  })
  it("retains originals and resumes from the last committed row after inference failure", async () => {
    await vectorDb.vectors.bulkAdd([source(1), source(2)])
    await nativeEmbeddingCommand("start")
    embed
      .mockResolvedValueOnce(vector())
      .mockRejectedValueOnce(new Error("worker lost"))
    await expect(nativeEmbeddingCommand("step")).rejects.toThrow("worker lost")
    expect((await nativeEmbeddingStatus()).current).toBe(1)
    expect((await nativeEmbeddingStatus()).mode).toBe("external")
    expect((await vectorDb.vectors.get(1))?.metadata.embeddingModel).toBe("old")
    await nativeEmbeddingCommand("step")
    expect((await nativeEmbeddingStatus()).mode).toBe("bundled")
    expect(embed.mock.calls.map(([text]) => text)).toEqual([
      "saved content 1",
      "saved content 2",
      "saved content 2"
    ])
  })
  it.each([
    "delete",
    "add",
    "edit"
  ])("refuses an atomic switch after a concurrent %s", async (change) => {
    await vectorDb.vectors.add(source(1))
    await nativeEmbeddingCommand("start")
    if (change === "delete") await vectorDb.vectors.delete(1)
    if (change === "add") await vectorDb.vectors.add(source(2))
    if (change === "edit")
      await vectorDb.vectors.update(1, { content: "changed" })
    const current = await vectorDb.vectors.toArray()
    await nativeEmbeddingCommand("step")
    expect((await nativeEmbeddingStatus()).migration).toBe("changed")
    expect((await nativeEmbeddingStatus()).mode).toBe("external")
    expect(await vectorDb.vectors.toArray()).toEqual(current)
  })
  it("handles an empty corpus, and keeping external never changes vectors", async () => {
    await nativeEmbeddingCommand("start")
    await nativeEmbeddingCommand("step")
    expect((await readNativeIndexState()).mode).toBe("bundled")
    await nativeEmbeddingCommand("external")
    await vectorDb.vectors.add(source(1))
    await nativeEmbeddingCommand("start")
    await nativeEmbeddingCommand("keep")
    expect((await nativeEmbeddingStatus()).dismissed).toBe(true)
    expect((await nativeEmbeddingStatus()).mode).toBe("external")
    expect(await vectorDb.embeddingRebuild.count()).toBe(0)
    expect(await vectorDb.vectors.get(1)).toEqual(source(1))
  })
  it("aborts without changing either the index or its active model", async () => {
    await vectorDb.vectors.add(source(1))
    await nativeEmbeddingCommand("start")
    const controller = new AbortController()
    embed.mockImplementationOnce(async () => {
      controller.abort()
      return vector()
    })
    await expect(
      nativeEmbeddingCommand("step", controller.signal)
    ).rejects.toThrow()
    expect((await nativeEmbeddingStatus()).current).toBe(0)
    expect((await nativeEmbeddingStatus()).mode).toBe("external")
    expect(await vectorDb.vectors.get(1)).toEqual(source(1))
  })
})
