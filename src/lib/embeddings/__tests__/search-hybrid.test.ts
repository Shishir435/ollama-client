import { beforeEach, describe, expect, it, vi } from "vitest"
import { keywordIndexManager } from "@/lib/embeddings/keyword-index"
import { plasmoGlobalStorage } from "@/lib/plasmo-global-storage"
import { searchHybrid, vectorDb } from "../vector-store"

vi.mock("@/lib/embeddings/keyword-index", () => ({
  keywordIndexManager: {
    search: vi.fn(),
    addDocument: vi.fn(),
    removeDocument: vi.fn()
  }
}))

vi.mock("@/lib/embeddings/hnsw-index", () => ({
  hnswIndexManager: {
    addVector: vi.fn(),
    search: vi.fn(),
    shouldUseHNSW: vi.fn().mockResolvedValue(false), // brute-force so DB controls results
    isCompatibleDimension: vi.fn().mockReturnValue(true),
    isDeletionRebuildPending: vi.fn().mockReturnValue(false),
    markDeletionDirty: vi.fn().mockResolvedValue(undefined),
    flushPendingDeletionRebuild: vi.fn().mockResolvedValue(undefined),
    buildIndex: vi.fn().mockResolvedValue(undefined),
    getStats: vi.fn().mockReturnValue({
      isInitialized: false,
      dimension: null,
      numElements: 0,
      isBuilding: false,
      buildProgress: 0,
      memorySizeMB: 0
    })
  }
}))

vi.mock("@/lib/plasmo-global-storage", () => ({
  plasmoGlobalStorage: {
    get: vi.fn(),
    set: vi.fn()
  }
}))

// Disable search cache so each test sees the current DB state
vi.mock("../cache", async (importOriginal) => {
  const mod = await importOriginal<typeof import("../cache")>()
  return {
    ...mod,
    searchCache: { get: () => null, set: vi.fn() },
    cleanSearchCache: vi.fn().mockResolvedValue(undefined),
    getCacheConfig: vi.fn().mockResolvedValue({ ttl: 0 })
  }
})

// Docs with 2-d embeddings. [1,0] and [0,1] are orthogonal; similarity to [1,0] query:
// docA: 1.0  docB: 0.0  docC: ~0.7
const docA = {
  id: 1,
  content: "TypeScript generics and type inference",
  embedding: [1, 0],
  metadata: {
    source: "ts-docs",
    title: "TypeScript Handbook",
    type: "file" as const,
    timestamp: 1
  }
}
const docB = {
  id: 2,
  content: "Python list comprehension examples",
  embedding: [0, 1],
  metadata: {
    source: "py-docs",
    title: "Python Tutorial",
    type: "file" as const,
    timestamp: 2
  }
}
const docC = {
  id: 3,
  content: "JavaScript async await patterns",
  embedding: [Math.SQRT1_2, Math.SQRT1_2],
  metadata: {
    source: "js-docs",
    title: "JavaScript Guide",
    type: "file" as const,
    timestamp: 3
  }
}

const noKeywordResults = () =>
  vi.mocked(keywordIndexManager.search).mockReturnValue([])

beforeEach(async () => {
  await vectorDb.vectors.clear()
  vi.clearAllMocks()
  vi.mocked(plasmoGlobalStorage.get).mockResolvedValue({})
})

describe("searchHybrid — RRF fusion", () => {
  it("doc in both lists scores higher than doc in only one list", async () => {
    await vectorDb.vectors.bulkAdd([docA, docB] as any)

    // keyword: only docA (rank 0)
    vi.mocked(keywordIndexManager.search).mockReturnValue([
      { id: 1, score: 10, document: docA as any, terms: ["typescript"] }
    ])

    // semantic: docA rank 0 (similarity 1.0), docB rank 1 (similarity 0.0)
    const results = await searchHybrid("typescript generics", [1, 0], {
      limit: 5,
      keywordWeight: 0.5,
      semanticWeight: 0.5
    })

    expect(results.length).toBeGreaterThan(0)
    // docA appears in both lists → highest RRF score
    expect(results[0].document.id).toBe(1)
  })

  it("doc appearing in both lists outranks doc in single list even with lower individual rank", async () => {
    await vectorDb.vectors.bulkAdd([docA, docB, docC] as any)

    // keyword: docB rank 0, docC rank 1 — docA absent
    vi.mocked(keywordIndexManager.search).mockReturnValue([
      { id: 2, score: 20, document: docB as any, terms: ["python"] },
      { id: 3, score: 10, document: docC as any, terms: ["script"] }
    ])

    // semantic: query [1,0] → docA rank 0, docC rank 1, docB rank 2 (approx)
    // docC appears in both keyword (rank 1) and semantic (rank 1) → beats docB (keyword only)
    const results = await searchHybrid("script patterns", [1, 0], {
      limit: 5,
      keywordWeight: 0.5,
      semanticWeight: 0.5
    })

    const cIdx = results.findIndex((r) => r.document.id === 3)
    const bIdx = results.findIndex((r) => r.document.id === 2)
    // docC (both lists) should beat docB (keyword-only)
    expect(cIdx).toBeLessThan(bIdx)
  })

  it("scores are normalized to [0, 1]", async () => {
    await vectorDb.vectors.bulkAdd([docA, docB, docC] as any)

    vi.mocked(keywordIndexManager.search).mockReturnValue([
      { id: 1, score: 100, document: docA as any, terms: ["typescript"] },
      { id: 2, score: 50, document: docB as any, terms: ["python"] }
    ])

    const results = await searchHybrid("typescript", [1, 0], {
      limit: 10
    })

    for (const r of results) {
      expect(r.similarity).toBeGreaterThanOrEqual(0)
      expect(r.similarity).toBeLessThanOrEqual(1)
    }
  })

  it("top result has similarity === 1.0 (batch-normalized)", async () => {
    await vectorDb.vectors.bulkAdd([docA, docB] as any)

    vi.mocked(keywordIndexManager.search).mockReturnValue([
      { id: 1, score: 10, document: docA as any, terms: ["typescript"] }
    ])

    const results = await searchHybrid("typescript", [1, 0], {
      limit: 5
    })

    expect(results[0].similarity).toBeCloseTo(1.0, 5)
  })

  it("respects limit option", async () => {
    await vectorDb.vectors.bulkAdd([docA, docB, docC] as any)

    vi.mocked(keywordIndexManager.search).mockReturnValue([
      { id: 1, score: 30, document: docA as any, terms: ["a"] },
      { id: 2, score: 20, document: docB as any, terms: ["b"] },
      { id: 3, score: 10, document: docC as any, terms: ["c"] }
    ])

    const results = await searchHybrid("query", [1, 0], {
      limit: 2
    })

    expect(results.length).toBeLessThanOrEqual(2)
  })
})

describe("searchHybrid — title boost", () => {
  it("doc with query term in title scores higher than same-ranked doc without", async () => {
    // docA has "TypeScript" in title; docB does not. Both at same semantic rank.
    // Use identical embeddings so semantic rank is effectively tied.
    const docAMirror = { ...docA, id: 10, embedding: [1, 0] }
    const docBNoTitle = {
      id: 20,
      content: "Generics and inference concepts",
      embedding: [1, 0],
      metadata: {
        source: "other",
        title: "General Reference",
        type: "file" as const,
        timestamp: 4
      }
    }

    await vectorDb.vectors.bulkAdd([docAMirror, docBNoTitle] as any)

    // No keyword results so ranking is purely semantic + title boost
    noKeywordResults()

    const results = await searchHybrid("typescript generics", [1, 0], {
      limit: 5
    })

    const aIdx = results.findIndex((r) => r.document.id === 10)
    const bIdx = results.findIndex((r) => r.document.id === 20)

    expect(aIdx).not.toBe(-1)
    expect(bIdx).not.toBe(-1)
    // docAMirror title contains "typescript" → higher score
    expect(results[aIdx].similarity).toBeGreaterThan(results[bIdx].similarity)
  })

  it("title boost stays within [0, 1] even for many term matches", async () => {
    const docTitleHeavy = {
      id: 99,
      content: "Content here",
      embedding: [1, 0],
      metadata: {
        source: "s",
        title: "typescript generics inference patterns advanced",
        type: "file" as const,
        timestamp: 1
      }
    }
    await vectorDb.vectors.bulkAdd([docTitleHeavy] as any)
    noKeywordResults()

    const results = await searchHybrid(
      "typescript generics inference patterns advanced",
      [1, 0],
      {
        limit: 5
      }
    )

    expect(results[0].similarity).toBeLessThanOrEqual(1.0)
  })
})

describe("searchHybrid — edge cases", () => {
  it("returns empty array when DB and keyword index are both empty", async () => {
    noKeywordResults()
    const results = await searchHybrid("anything", [1, 0], {})
    expect(results).toHaveLength(0)
  })

  it("handles keyword-only results (no semantic matches above threshold)", async () => {
    // Use a high minSimilarity so semantic returns nothing, keyword has results
    const lowSimDoc = {
      id: 5,
      content: "Some content",
      embedding: [0, 1], // orthogonal to query [1,0] → similarity ~0
      metadata: {
        source: "s",
        title: "Doc",
        type: "file" as const,
        timestamp: 1
      }
    }
    await vectorDb.vectors.bulkAdd([lowSimDoc] as any)

    vi.mocked(keywordIndexManager.search).mockReturnValue([
      { id: 5, score: 10, document: lowSimDoc as any, terms: ["content"] }
    ])

    const results = await searchHybrid("content", [1, 0], {
      minSimilarity: 0.99 // blocks semantic
    })

    // keyword result should still surface via RRF
    expect(results.length).toBeGreaterThan(0)
    expect(results[0].document.id).toBe(5)
  })

  it("handles semantic-only results (empty keyword list)", async () => {
    await vectorDb.vectors.bulkAdd([docA] as any)
    noKeywordResults()

    const results = await searchHybrid("typescript", [1, 0], {})

    expect(results.length).toBeGreaterThan(0)
    expect(results[0].document.id).toBe(1)
  })

  it("results are sorted descending by similarity", async () => {
    await vectorDb.vectors.bulkAdd([docA, docB, docC] as any)

    vi.mocked(keywordIndexManager.search).mockReturnValue([
      { id: 1, score: 30, document: docA as any, terms: ["a"] },
      { id: 2, score: 10, document: docB as any, terms: ["b"] }
    ])

    const results = await searchHybrid("query", [1, 0], {
      limit: 10
    })

    for (let i = 1; i < results.length; i++) {
      expect(results[i - 1].similarity).toBeGreaterThanOrEqual(
        results[i].similarity
      )
    }
  })
})
