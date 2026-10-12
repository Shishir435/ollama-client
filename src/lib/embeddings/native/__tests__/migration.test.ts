import { beforeEach, describe, expect, it, vi } from "vitest"
import {
  getPlasmoStoredValue,
  setPlasmoStoredValue
} from "@/lib/plasmo-global-storage"
import { vectorDb } from "../../db"
import { storeVector } from "../../storage"
import { BUNDLED_MODEL } from "../constants"
import {
  nativeEmbeddingCommand,
  nativeEmbeddingStatus,
  requestNativeEmbeddingCommand,
  resumeNativeMigration
} from "../migration"
import { initializeBundledInstall, readNativeIndexState } from "../state"

const { embed, externalEmbed } = vi.hoisted(() => ({
  embed: vi.fn(),
  externalEmbed: vi.fn()
}))
vi.mock("../../embedding-strategy", () => ({
  resolveEmbeddingPlan: vi.fn(async () => ({
    fingerprint: "external-plan",
    attempts: [
      {
        model: "external-model",
        providerId: "ollama",
        provider: { id: "ollama", embed: vi.fn() }
      },
      {
        model: "fallback-model",
        providerId: "fallback",
        provider: { id: "fallback", embed: vi.fn() }
      }
    ]
  })),
  generateEmbeddingWithStrategy: externalEmbed
}))
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
  externalEmbed.mockReset().mockResolvedValue({
    embedding: [0, 1],
    model: "external-model",
    providerId: "ollama"
  })
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
  ])("catches up a concurrent %s without losing saved content", async (change) => {
    await vectorDb.vectors.add(source(1))
    await nativeEmbeddingCommand("start")
    if (change === "delete") await vectorDb.vectors.delete(1)
    if (change === "add") await vectorDb.vectors.add(source(2))
    if (change === "edit")
      await vectorDb.vectors.update(1, { content: "changed" })
    const current = await vectorDb.vectors.toArray()
    await nativeEmbeddingCommand("step")
    for (
      let i = 0;
      i < 3 && (await nativeEmbeddingStatus()).migration === "building";
      i++
    )
      await nativeEmbeddingCommand("step")
    expect((await nativeEmbeddingStatus()).mode).toBe("bundled")
    expect(
      (await vectorDb.vectors.toArray()).map((row) => row.content)
    ).toEqual(current.map((row) => row.content))
  })
  it("handles an empty corpus, and keeping external never changes vectors", async () => {
    await nativeEmbeddingCommand("start")
    await nativeEmbeddingCommand("step")
    expect((await readNativeIndexState()).mode).toBe("bundled")
    await nativeEmbeddingCommand("external")
    await nativeEmbeddingCommand("step")
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

it("preserves bundled retrieval until external rebuild completes, including newly added content", async () => {
  await vectorDb.vectors.add(source(1))
  await nativeEmbeddingCommand("start")
  await nativeEmbeddingCommand("step")
  await vectorDb.vectors.add({
    ...source(2),
    embedding: vector(),
    metadata: {
      ...source(2).metadata,
      embeddingModel: BUNDLED_MODEL,
      embeddingProviderId: "bundled"
    }
  })
  const originals = await vectorDb.vectors.toArray()
  await nativeEmbeddingCommand("external")
  expect((await nativeEmbeddingStatus()).mode).toBe("bundled")
  externalEmbed.mockRejectedValueOnce(new Error("provider offline"))
  await expect(nativeEmbeddingCommand("step")).rejects.toThrow(
    "provider offline"
  )
  expect(await vectorDb.vectors.toArray()).toEqual(originals)
  expect((await nativeEmbeddingStatus()).mode).toBe("bundled")
  await nativeEmbeddingCommand("step")
  expect((await nativeEmbeddingStatus()).mode).toBe("external")
  const rows = await vectorDb.vectors.toArray()
  expect(rows).toHaveLength(2)
  expect(
    rows.every(
      (row) =>
        row.metadata.embeddingModel === "external-model" &&
        row.embedding.length === 2
    )
  ).toBe(true)
})
it("passive dismissal preserves committed migration batches", async () => {
  await vectorDb.vectors.bulkAdd(
    Array.from({ length: 10 }, (_, i) => source(i + 1))
  )
  await nativeEmbeddingCommand("start")
  await nativeEmbeddingCommand("step")
  const staged = await vectorDb.embeddingRebuild.toArray()
  await nativeEmbeddingCommand("dismiss")
  expect((await nativeEmbeddingStatus()).dismissed).toBe(true)
  expect((await nativeEmbeddingStatus()).current).toBe(8)
  expect(await vectorDb.embeddingRebuild.toArray()).toEqual(staged)
  await nativeEmbeddingCommand("step")
  expect((await nativeEmbeddingStatus()).mode).toBe("bundled")
})
it("returns progress after the wall-clock batch budget instead of starting another slow row", async () => {
  await vectorDb.vectors.bulkAdd([source(1), source(2)])
  await nativeEmbeddingCommand("start")
  const now = Date.now()
  const clock = vi.spyOn(Date, "now").mockReturnValue(now)
  embed.mockImplementationOnce(async () => {
    clock.mockReturnValue(now + 31000)
    return vector()
  })
  try {
    await nativeEmbeddingCommand("step")
    expect((await nativeEmbeddingStatus()).current).toBe(1)
    expect((await nativeEmbeddingStatus()).mode).toBe("external")
  } finally {
    clock.mockRestore()
  }
  await nativeEmbeddingCommand("step")
  expect((await nativeEmbeddingStatus()).mode).toBe("bundled")
})

it("pins every resumed external batch to one route and refuses mixed staged vectors", async () => {
  await vectorDb.vectors.bulkAdd(
    Array.from({ length: 10 }, (_, i) => source(i + 1))
  )
  await nativeEmbeddingCommand("start")
  await nativeEmbeddingCommand("step")
  await nativeEmbeddingCommand("step")
  const original = await vectorDb.vectors.toArray()
  await nativeEmbeddingCommand("external")
  await nativeEmbeddingCommand("step")
  expect((await nativeEmbeddingStatus()).mode).toBe("bundled")
  for (const [, , options] of externalEmbed.mock.calls) {
    expect(options.plan.attempts).toHaveLength(1)
    expect(options.plan.attempts[0].provider.id).toBe("ollama")
  }
  // An older build could have staged a fallback row; never commit it on resume.
  await vectorDb.embeddingRebuild.update(1, {
    providerId: "fallback",
    model: "fallback-model"
  })
  await nativeEmbeddingCommand("step")
  expect((await nativeEmbeddingStatus()).migration).toBe("changed")
  expect((await nativeEmbeddingStatus()).mode).toBe("bundled")
  expect(await vectorDb.vectors.toArray()).toEqual(original)
})
it("requires successful inference before switching an empty corpus to external", async () => {
  await initializeBundledInstall()
  await nativeEmbeddingCommand("external")
  externalEmbed.mockRejectedValueOnce(new Error("preferred provider offline"))
  await expect(nativeEmbeddingCommand("step")).rejects.toThrow(
    "preferred provider offline"
  )
  expect((await nativeEmbeddingStatus()).mode).toBe("bundled")
  await nativeEmbeddingCommand("step")
  expect((await nativeEmbeddingStatus()).mode).toBe("external")
  expect(externalEmbed).toHaveBeenCalledWith(
    "Embedding provider readiness check",
    undefined,
    expect.any(Object)
  )
})
it("does not commit fallback results when the preferred provider fails mid-rebuild", async () => {
  await vectorDb.vectors.bulkAdd([source(1), source(2)])
  await nativeEmbeddingCommand("start")
  await nativeEmbeddingCommand("step")
  const original = await vectorDb.vectors.toArray()
  await nativeEmbeddingCommand("external")
  externalEmbed
    .mockResolvedValueOnce({
      embedding: [1, 0],
      model: "external-model",
      providerId: "ollama"
    })
    .mockResolvedValueOnce({
      embedding: [0, 1],
      model: "fallback-model",
      providerId: "fallback"
    })
  await expect(nativeEmbeddingCommand("step")).rejects.toThrow(
    "incompatible vectors"
  )
  expect((await nativeEmbeddingStatus()).mode).toBe("bundled")
  expect(await vectorDb.vectors.toArray()).toEqual(original)
  await nativeEmbeddingCommand("step")
  expect((await nativeEmbeddingStatus()).mode).toBe("external")
})

it("keeps completed unchanged rows while catching up live edits and inserts", async () => {
  await vectorDb.vectors.bulkAdd(
    Array.from({ length: 10 }, (_, i) => source(i + 1))
  )
  await nativeEmbeddingCommand("start")
  await nativeEmbeddingCommand("step")
  expect(embed).toHaveBeenCalledTimes(8)
  await vectorDb.vectors.update(1, { content: "updated first row" })
  await vectorDb.vectors.delete(2)
  await vectorDb.vectors.add(source(11))
  await nativeEmbeddingCommand("step")
  expect((await nativeEmbeddingStatus()).mode).toBe("external")
  expect((await nativeEmbeddingStatus()).current).toBe(8)
  await nativeEmbeddingCommand("step")
  expect((await nativeEmbeddingStatus()).mode).toBe("bundled")
  expect(embed).toHaveBeenCalledTimes(12)
  expect(await vectorDb.vectors.get(2)).toBeUndefined()
  expect((await vectorDb.vectors.get(1))?.content).toBe("updated first row")
  expect((await vectorDb.vectors.get(11))?.metadata.embeddingModel).toBe(
    BUNDLED_MODEL
  )
})
it("cancels in-flight rebuilds from another settings view without switching the active route", async () => {
  await initializeBundledInstall()
  await vectorDb.vectors.add(source(1))
  await nativeEmbeddingCommand("external")
  externalEmbed.mockImplementationOnce(
    (_text, _model, { signal }) =>
      new Promise((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(signal.reason), {
          once: true
        })
      })
  )
  const step = nativeEmbeddingCommand("step")
  const rejected = expect(step).rejects.toMatchObject({ name: "AbortError" })
  await vi.waitFor(() => expect(externalEmbed).toHaveBeenCalled())
  await nativeEmbeddingCommand("cancel")
  await rejected
  expect((await nativeEmbeddingStatus()).mode).toBe("bundled")
  expect((await nativeEmbeddingStatus()).migration).toBe("idle")
  expect(await vectorDb.embeddingRebuild.count()).toBe(0)
})

it.each([
  "cancel",
  "keep"
] as const)("%s invalidates steps already queued by another view", async (action) => {
  await vectorDb.vectors.add(source(1))
  await nativeEmbeddingCommand("start")
  embed.mockImplementationOnce(
    (_text, signal) =>
      new Promise((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(signal.reason), {
          once: true
        })
      })
  )
  const running = nativeEmbeddingCommand("step")
  const runningRejected = expect(running).rejects.toMatchObject({
    name: "AbortError"
  })
  await vi.waitFor(() => expect(embed).toHaveBeenCalledTimes(1))
  const queued = nativeEmbeddingCommand("step")
  const queuedRejected = expect(queued).rejects.toMatchObject({
    name: "AbortError"
  })
  await nativeEmbeddingCommand(action)
  await Promise.all([runningRejected, queuedRejected])
  expect(embed).toHaveBeenCalledTimes(1)
  expect((await nativeEmbeddingStatus()).mode).toBe("external")
  expect((await nativeEmbeddingStatus()).migration).toBe("idle")
  expect(await vectorDb.embeddingRebuild.count()).toBe(0)
  // A deliberate new migration is still allowed after cancellation.
  await nativeEmbeddingCommand("start")
  await nativeEmbeddingCommand("step")
  expect((await nativeEmbeddingStatus()).mode).toBe("bundled")
})

describe("background rebuild driver", () => {
  it("finishes a started rebuild without a page stepping it", async () => {
    for (let id = 1; id <= 10; id++) await vectorDb.vectors.add(source(id))
    await requestNativeEmbeddingCommand("start")
    await vi.waitFor(async () =>
      expect((await nativeEmbeddingStatus()).mode).toBe("bundled")
    )
    expect(embed).toHaveBeenCalledTimes(10)
    expect((await nativeEmbeddingStatus()).migration).toBe("idle")
  })

  it("keeps a start whose page closed during the snapshot", async () => {
    for (let id = 1; id <= 3; id++) await vectorDb.vectors.add(source(id))
    const page = new AbortController()
    const started = requestNativeEmbeddingCommand("start", page.signal)
    page.abort()
    await started
    await vi.waitFor(async () =>
      expect((await nativeEmbeddingStatus()).mode).toBe("bundled")
    )
    expect(embed).toHaveBeenCalledTimes(3)
  })

  it("stops batching once cancelled", async () => {
    await vectorDb.vectors.add(source(1))
    embed.mockImplementationOnce(
      (_text, signal) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(signal.reason), {
            once: true
          })
        })
    )
    await requestNativeEmbeddingCommand("start")
    await vi.waitFor(() => expect(embed).toHaveBeenCalledTimes(1))
    await requestNativeEmbeddingCommand("cancel")
    const state = await readNativeIndexState()
    expect(state.migration).toBe("idle")
    expect(state.failed).toBeUndefined()
    expect(embed).toHaveBeenCalledTimes(1)
  })

  it("records a failed batch and waits for resume instead of retrying at startup", async () => {
    await vectorDb.vectors.add(source(1))
    embed.mockRejectedValueOnce(new Error("worker lost"))
    await requestNativeEmbeddingCommand("start")
    await vi.waitFor(async () =>
      expect((await readNativeIndexState()).failed).toBe(true)
    )
    await resumeNativeMigration()
    await nativeEmbeddingStatus()
    expect(embed).toHaveBeenCalledTimes(1)
    expect((await readNativeIndexState()).migration).toBe("building")

    await requestNativeEmbeddingCommand("resume")
    await vi.waitFor(async () =>
      expect((await nativeEmbeddingStatus()).mode).toBe("bundled")
    )
    expect((await readNativeIndexState()).failed).toBeUndefined()
  })

  it("records a provider AbortError as a failure rather than stalling", async () => {
    await vectorDb.vectors.add(source(1))
    embed.mockRejectedValueOnce(new DOMException("fetch aborted", "AbortError"))
    await requestNativeEmbeddingCommand("start")
    await vi.waitFor(async () =>
      expect((await readNativeIndexState()).failed).toBe(true)
    )
  })

  it("starts a fresh driver right after a cancel", async () => {
    await vectorDb.vectors.add(source(1))
    embed.mockImplementationOnce(
      (_text, signal) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(signal.reason), {
            once: true
          })
        })
    )
    await requestNativeEmbeddingCommand("start")
    await vi.waitFor(() => expect(embed).toHaveBeenCalledTimes(1))
    await Promise.all([
      requestNativeEmbeddingCommand("cancel"),
      requestNativeEmbeddingCommand("start")
    ])
    await vi.waitFor(async () =>
      expect((await nativeEmbeddingStatus()).mode).toBe("bundled")
    )
    expect((await readNativeIndexState()).failed).toBeUndefined()
  })

  it("resumes an interrupted rebuild at startup", async () => {
    for (let id = 1; id <= 3; id++) await vectorDb.vectors.add(source(id))
    await nativeEmbeddingCommand("start")
    expect(embed).not.toHaveBeenCalled()
    await resumeNativeMigration()
    await vi.waitFor(async () =>
      expect((await nativeEmbeddingStatus()).mode).toBe("bundled")
    )
    expect(embed).toHaveBeenCalledTimes(3)
  })
})
