import { describe, expect, it } from "vitest"

import type { ChatMessage, FileAttachment } from "@/types"

import {
  buildSiblingsMap,
  collectDescendantIds,
  compareMessages,
  enrichPathWithSiblingsAndAttachments,
  findLatestLeafDescendant,
  groupFilesByMessageId,
  traversePathFromLeaf,
  traversePathFromLeafWithFetcher
} from "../message-tree"

const msg = (overrides: Partial<ChatMessage>): ChatMessage => ({
  role: "user",
  content: "",
  ...overrides
})

describe("compareMessages", () => {
  it("orders by timestamp ascending", () => {
    expect(
      [msg({ timestamp: 2 }), msg({ timestamp: 1 })].sort(compareMessages)
    ).toEqual([msg({ timestamp: 1 }), msg({ timestamp: 2 })])
  })

  it("falls back to lexicographic id comparison on tied timestamps", () => {
    const a = msg({ id: 2, timestamp: 100 })
    const b = msg({ id: 10, timestamp: 100 })
    // "10" < "2" lexicographically, so b sorts first.
    expect([a, b].sort(compareMessages)).toEqual([b, a])
  })

  it("treats missing timestamp as 0", () => {
    const a = msg({ id: 1 })
    const b = msg({ id: 2, timestamp: 1 })
    expect([b, a].sort(compareMessages)[0]).toBe(a)
  })
})

describe("buildSiblingsMap", () => {
  it("groups by parentId and assigns roots to the 'root' key", () => {
    const m1 = msg({ id: 1, timestamp: 1 })
    const m2 = msg({ id: 2, parentId: 1, timestamp: 2 })
    const m3 = msg({ id: 3, parentId: 1, timestamp: 3 })
    const map = buildSiblingsMap([m1, m2, m3])
    expect(map.get("root")).toEqual([m1])
    expect(map.get(1)).toEqual([m2, m3])
  })

  it("sorts each sibling list by compareMessages", () => {
    const m2 = msg({ id: 2, parentId: 1, timestamp: 200 })
    const m3 = msg({ id: 3, parentId: 1, timestamp: 100 })
    const map = buildSiblingsMap([m2, m3])
    expect(map.get(1)).toEqual([m3, m2])
  })
})

describe("traversePathFromLeaf", () => {
  const root = msg({ id: 1, timestamp: 1 })
  const child = msg({ id: 2, parentId: 1, timestamp: 2 })
  const grandchild = msg({ id: 3, parentId: 2, timestamp: 3 })
  const all = [root, child, grandchild]

  it("walks from leaf up to root and returns root-to-leaf order", () => {
    expect(traversePathFromLeaf(all, 3, 10)).toEqual({
      path: [root, child, grandchild],
      hasMore: false
    })
  })

  it("stops at the limit and reports hasMore=true", () => {
    expect(traversePathFromLeaf(all, 3, 2)).toEqual({
      path: [child, grandchild],
      hasMore: true
    })
  })

  it("returns empty path if leaf id is not in the message list; hasMore reflects that traversal stopped short", () => {
    // currentId is still defined (the unresolvable 999), so callers see hasMore=true.
    expect(traversePathFromLeaf(all, 999, 10)).toEqual({
      path: [],
      hasMore: true
    })
  })
})

describe("traversePathFromLeafWithFetcher", () => {
  it("calls fetcher once per step and stops at root", async () => {
    const root = msg({ id: 1 })
    const child = msg({ id: 2, parentId: 1 })
    const lookups: Array<number | string> = []
    const fetcher = async (id: number | string) => {
      lookups.push(id)
      return id === 1 ? root : id === 2 ? child : undefined
    }

    const result = await traversePathFromLeafWithFetcher(2, 10, fetcher)
    expect(result).toEqual({ path: [root, child], hasMore: false })
    expect(lookups).toEqual([2, 1])
  })

  it("stops at the limit", async () => {
    const fetcher = async (id: number | string): Promise<ChatMessage> =>
      msg({ id: Number(id), parentId: Number(id) - 1 })
    const result = await traversePathFromLeafWithFetcher(5, 2, fetcher)
    expect(result.path).toHaveLength(2)
    expect(result.hasMore).toBe(true)
  })
})

describe("collectDescendantIds", () => {
  it("collects the root and every transitive descendant", () => {
    const messages = [
      msg({ id: 1 }),
      msg({ id: 2, parentId: 1 }),
      msg({ id: 3, parentId: 2 }),
      msg({ id: 4, parentId: 2 }),
      msg({ id: 5, parentId: 99 }) // unrelated branch
    ]
    expect(Array.from(collectDescendantIds(messages, 1)).sort()).toEqual([
      1, 2, 3, 4
    ])
  })

  it("returns just the root when there are no descendants", () => {
    const messages = [msg({ id: 1 }), msg({ id: 2 })]
    expect(Array.from(collectDescendantIds(messages, 1))).toEqual([1])
  })
})

describe("groupFilesByMessageId", () => {
  it("buckets files by their numeric messageId", () => {
    const files: FileAttachment[] = [
      {
        fileId: "a",
        fileName: "a.txt",
        fileType: "text",
        fileSize: 1,
        processedAt: 0,
        messageId: 1
      },
      {
        fileId: "b",
        fileName: "b.txt",
        fileType: "text",
        fileSize: 1,
        processedAt: 0,
        messageId: 1
      },
      {
        fileId: "c",
        fileName: "c.txt",
        fileType: "text",
        fileSize: 1,
        processedAt: 0,
        messageId: 2
      }
    ]
    const map = groupFilesByMessageId(files)
    expect(map.get(1)).toHaveLength(2)
    expect(map.get(2)).toHaveLength(1)
  })

  it("skips files without a numeric messageId", () => {
    const map = groupFilesByMessageId([
      {
        fileId: "a",
        fileName: "a.txt",
        fileType: "text",
        fileSize: 1,
        processedAt: 0
      }
    ])
    expect(map.size).toBe(0)
  })
})

describe("enrichPathWithSiblingsAndAttachments", () => {
  it("attaches files and only emits siblingIds when multiple siblings exist", () => {
    const path: ChatMessage[] = [
      msg({ id: 1, parentId: "root" }),
      msg({ id: 2, parentId: 1 })
    ]
    const siblingsMap = new Map<number | string, ChatMessage[]>([
      ["root", [path[0]]],
      [1, [path[1], msg({ id: 3, parentId: 1 })]]
    ])
    const filesByMessageId = new Map<number, FileAttachment[]>([
      [
        2,
        [
          {
            fileId: "f",
            fileName: "f.txt",
            fileType: "text",
            fileSize: 1,
            processedAt: 0,
            messageId: 2
          }
        ]
      ]
    ])
    const enriched = enrichPathWithSiblingsAndAttachments(
      path,
      siblingsMap,
      filesByMessageId
    )
    // No siblings for the root message -> no siblingIds.
    expect(enriched[0].siblingIds).toBeUndefined()
    expect(enriched[0].attachments).toEqual([])
    // Two siblings for the child -> siblingIds populated.
    expect(enriched[1].siblingIds).toEqual([2, 3])
    expect(enriched[1].attachments).toHaveLength(1)
  })
})

describe("findLatestLeafDescendant", () => {
  it("walks down to the timestamp-latest descendant", () => {
    const messages: ChatMessage[] = [
      msg({ id: 1, timestamp: 1 }),
      msg({ id: 2, parentId: 1, timestamp: 2 }),
      msg({ id: 3, parentId: 2, timestamp: 3 }),
      msg({ id: 4, parentId: 2, timestamp: 4 })
    ]
    expect(findLatestLeafDescendant(messages, 1)).toBe(4)
  })

  it("returns the node itself when it has no children", () => {
    const messages: ChatMessage[] = [msg({ id: 1 })]
    expect(findLatestLeafDescendant(messages, 1)).toBe(1)
  })
})
