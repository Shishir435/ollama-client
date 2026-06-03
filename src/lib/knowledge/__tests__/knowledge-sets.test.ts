import { beforeEach, describe, expect, it, vi } from "vitest"
import { plasmoGlobalStorage } from "@/lib/plasmo-global-storage"

vi.mock("@/lib/plasmo-global-storage", () => ({
  plasmoGlobalStorage: {
    get: vi.fn().mockResolvedValue(undefined),
    set: vi.fn().mockResolvedValue(undefined),
    remove: vi.fn().mockResolvedValue(undefined)
  }
}))

import {
  addFileToKnowledgeSet,
  createKnowledgeSet,
  DEFAULT_KNOWLEDGE_SET_ID,
  DEFAULT_KNOWLEDGE_SET_NAME,
  DEFAULT_RAG_PROMPT,
  deleteKnowledgeSet,
  ensureDefaultKnowledgeSet,
  getActiveKnowledgeSetId,
  getKnowledgeSet,
  getKnowledgeSetFileIds,
  type KnowledgeFileRecord,
  knowledgeDb,
  listKnowledgeSets,
  markKnowledgeFileEmbedded,
  setActiveKnowledgeSetId,
  updateKnowledgeSet
} from "../knowledge-sets"

const mockedStorage = plasmoGlobalStorage as unknown as {
  get: ReturnType<typeof vi.fn>
  set: ReturnType<typeof vi.fn>
  remove: ReturnType<typeof vi.fn>
}

beforeEach(async () => {
  await knowledgeDb.knowledgeSets.clear()
  await knowledgeDb.knowledgeFiles.clear()
  vi.clearAllMocks()
  mockedStorage.get.mockResolvedValue(undefined)
  mockedStorage.set.mockResolvedValue(undefined)
  mockedStorage.remove.mockResolvedValue(undefined)
})

describe("ensureDefaultKnowledgeSet", () => {
  it("creates default knowledge set when none exists", async () => {
    const record = await ensureDefaultKnowledgeSet()

    expect(record.id).toBe(DEFAULT_KNOWLEDGE_SET_ID)
    expect(record.name).toBe(DEFAULT_KNOWLEDGE_SET_NAME)
    expect(record.id).toBe("default")
    expect(record.name).toBe("Default")
  })

  it("returns existing record without creating a duplicate when called twice", async () => {
    const first = await ensureDefaultKnowledgeSet()
    const second = await ensureDefaultKnowledgeSet()

    expect(second.id).toBe(first.id)
    expect(second.createdAt).toBe(first.createdAt)

    const all = await knowledgeDb.knowledgeSets.toArray()
    expect(all).toHaveLength(1)
  })
})

describe("listKnowledgeSets", () => {
  it("returns array including the default knowledge set", async () => {
    const sets = await listKnowledgeSets()

    expect(sets.some((s) => s.id === DEFAULT_KNOWLEDGE_SET_ID)).toBe(true)
  })

  it("returns all created sets", async () => {
    await ensureDefaultKnowledgeSet()
    await createKnowledgeSet({ name: "Alpha" })
    await createKnowledgeSet({ name: "Beta" })

    const sets = await listKnowledgeSets()

    const names = sets.map((s) => s.name)
    expect(names).toContain("Default")
    expect(names).toContain("Alpha")
    expect(names).toContain("Beta")
    expect(sets).toHaveLength(3)
  })
})

describe("getKnowledgeSet", () => {
  it("returns the set by id", async () => {
    await ensureDefaultKnowledgeSet()
    const found = await getKnowledgeSet(DEFAULT_KNOWLEDGE_SET_ID)

    expect(found).toBeDefined()
    expect(found!.id).toBe(DEFAULT_KNOWLEDGE_SET_ID)
  })

  it("returns undefined for unknown id", async () => {
    const found = await getKnowledgeSet("does-not-exist")

    expect(found).toBeUndefined()
  })
})

describe("createKnowledgeSet", () => {
  it("creates a new set with name and optional description", async () => {
    const record = await createKnowledgeSet({
      name: "My Set",
      description: "A description"
    })

    expect(record.name).toBe("My Set")
    expect(record.description).toBe("A description")

    const stored = await getKnowledgeSet(record.id)
    expect(stored).toBeDefined()
  })

  it("created set has ragPrompt equal to DEFAULT_RAG_PROMPT", async () => {
    const record = await createKnowledgeSet({ name: "Prompt Check" })

    expect(record.ragPrompt).toBe(DEFAULT_RAG_PROMPT)
  })

  it("created set has unique id that is not 'default'", async () => {
    const a = await createKnowledgeSet({ name: "Set A" })
    const b = await createKnowledgeSet({ name: "Set B" })

    expect(a.id).not.toBe(DEFAULT_KNOWLEDGE_SET_ID)
    expect(b.id).not.toBe(DEFAULT_KNOWLEDGE_SET_ID)
    expect(a.id).not.toBe(b.id)
  })
})

describe("updateKnowledgeSet", () => {
  it("updates the name of an existing set", async () => {
    const created = await createKnowledgeSet({ name: "Original" })
    await updateKnowledgeSet(created.id, { name: "Renamed" })

    const updated = await getKnowledgeSet(created.id)
    expect(updated!.name).toBe("Renamed")
  })

  it("does nothing for an unknown id", async () => {
    await expect(
      updateKnowledgeSet("nonexistent-id", { name: "Ghost" })
    ).resolves.toBeUndefined()

    const notCreated = await getKnowledgeSet("nonexistent-id")
    expect(notCreated).toBeUndefined()
  })
})

describe("deleteKnowledgeSet", () => {
  it("cannot delete the default set (no-op)", async () => {
    await ensureDefaultKnowledgeSet()
    await deleteKnowledgeSet(DEFAULT_KNOWLEDGE_SET_ID)

    const stillExists = await getKnowledgeSet(DEFAULT_KNOWLEDGE_SET_ID)
    expect(stillExists).toBeDefined()
  })

  it("deletes a non-default set", async () => {
    const created = await createKnowledgeSet({ name: "Temporary" })
    await deleteKnowledgeSet(created.id)

    const gone = await getKnowledgeSet(created.id)
    expect(gone).toBeUndefined()
  })
})

describe("addFileToKnowledgeSet + getKnowledgeSetFileIds", () => {
  it("adding a file and listing ids returns the file's id", async () => {
    await ensureDefaultKnowledgeSet()

    const file: KnowledgeFileRecord = {
      id: "file-abc-123",
      knowledgeSetId: DEFAULT_KNOWLEDGE_SET_ID,
      fileName: "doc.pdf",
      fileType: "application/pdf",
      fileSize: 1024,
      createdAt: Date.now()
    }

    await addFileToKnowledgeSet(file)

    const ids = await getKnowledgeSetFileIds(DEFAULT_KNOWLEDGE_SET_ID)
    expect(ids).toContain("file-abc-123")
  })
})

describe("markKnowledgeFileEmbedded", () => {
  it("updates lastEmbeddedAt on the file record", async () => {
    await ensureDefaultKnowledgeSet()

    const file: KnowledgeFileRecord = {
      id: "file-embed-1",
      knowledgeSetId: DEFAULT_KNOWLEDGE_SET_ID,
      fileName: "embed.txt",
      fileType: "text/plain",
      fileSize: 256,
      createdAt: Date.now()
    }
    await addFileToKnowledgeSet(file)

    const embeddedAt = Date.now() + 1000
    await markKnowledgeFileEmbedded("file-embed-1", embeddedAt)

    const stored = await knowledgeDb.knowledgeFiles.get("file-embed-1")
    expect(stored!.lastEmbeddedAt).toBe(embeddedAt)
  })

  it("does nothing for an unknown file id", async () => {
    await expect(
      markKnowledgeFileEmbedded("no-such-file", Date.now())
    ).resolves.toBeUndefined()
  })
})

describe("getActiveKnowledgeSetId / setActiveKnowledgeSetId", () => {
  it("returns DEFAULT_KNOWLEDGE_SET_ID when nothing is stored", async () => {
    mockedStorage.get.mockResolvedValue(undefined)

    const id = await getActiveKnowledgeSetId()

    expect(id).toBe(DEFAULT_KNOWLEDGE_SET_ID)
  })

  it("returns the stored id when plasmoGlobalStorage.get returns a value", async () => {
    mockedStorage.get.mockResolvedValue("my-custom-set")

    const id = await getActiveKnowledgeSetId()

    expect(id).toBe("my-custom-set")
  })
})
