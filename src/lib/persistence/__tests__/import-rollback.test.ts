import { beforeEach, describe, expect, it, vi } from "vitest"
import {
  clearRollbackCopy,
  ROLLBACK_PATH,
  type RollbackPool,
  recoverInterruptedImport,
  restoreRollbackCopy,
  stageRollbackCopy
} from "../import-rollback"

const DB_PATH = "/chat-history.sqlite"

const bytes = (label: string): Uint8Array => new TextEncoder().encode(label)

/** Stands in for the opfs-sahpool utility: a path→bytes map. */
const createPool = (
  initial: Record<string, Uint8Array> = {}
): RollbackPool & { files: Map<string, Uint8Array> } => {
  const files = new Map(Object.entries(initial))
  return {
    files,
    getFileNames: () => [...files.keys()],
    unlink: (path) => {
      files.delete(path)
    },
    exportFile: async (path) => {
      const found = files.get(path)
      if (!found) throw new Error(`no such file: ${path}`)
      return found
    },
    importDb: (path, value) => {
      files.set(path, value)
    }
  }
}

describe("staging a rollback copy", () => {
  it("copies the live database aside", async () => {
    const pool = createPool({ [DB_PATH]: bytes("live history") })

    const staged = await stageRollbackCopy(pool, DB_PATH)

    expect(staged).toEqual(bytes("live history"))
    expect(pool.files.get(ROLLBACK_PATH)).toEqual(bytes("live history"))
  })

  it("stages nothing on a profile with no database yet", async () => {
    const pool = createPool()

    await expect(stageRollbackCopy(pool, DB_PATH)).resolves.toBeNull()
    expect(pool.files.has(ROLLBACK_PATH)).toBe(false)
  })

  it("replaces a copy left over from an earlier attempt", async () => {
    const pool = createPool({
      [DB_PATH]: bytes("current"),
      [ROLLBACK_PATH]: bytes("stale")
    })

    await stageRollbackCopy(pool, DB_PATH)

    expect(pool.files.get(ROLLBACK_PATH)).toEqual(bytes("current"))
  })
})

describe("undoing a failed replacement", () => {
  it("puts the pre-replacement database back and drops the copy", async () => {
    const pool = createPool({
      [DB_PATH]: bytes("half-written"),
      [ROLLBACK_PATH]: bytes("live history")
    })

    await restoreRollbackCopy(pool, DB_PATH, bytes("live history"))

    expect(pool.files.get(DB_PATH)).toEqual(bytes("live history"))
    expect(pool.files.has(ROLLBACK_PATH)).toBe(false)
  })

  it("keeps the copy when the restore itself fails", async () => {
    const pool = createPool({ [ROLLBACK_PATH]: bytes("live history") })
    pool.importDb = () => {
      throw new Error("pool is out of slots")
    }

    await expect(
      restoreRollbackCopy(pool, DB_PATH, bytes("live history"))
    ).rejects.toThrow("pool is out of slots")
    // Startup recovery is the last chance to save this data; deleting the copy
    // here would spend it.
    expect(pool.files.has(ROLLBACK_PATH)).toBe(true)
  })
})

describe("startup recovery", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {})
  })

  it("does nothing when no replacement was in flight", async () => {
    const pool = createPool({ [DB_PATH]: bytes("live history") })

    await expect(recoverInterruptedImport(pool, DB_PATH)).resolves.toBe(false)
    expect(pool.files.get(DB_PATH)).toEqual(bytes("live history"))
  })

  it("restores the copy a killed replacement left behind", async () => {
    // The worker died between staging and completing the replacement, so the
    // live file is whatever the interrupted write produced.
    const pool = createPool({
      [DB_PATH]: bytes("truncated"),
      [ROLLBACK_PATH]: bytes("live history")
    })

    await expect(recoverInterruptedImport(pool, DB_PATH)).resolves.toBe(true)

    expect(pool.files.get(DB_PATH)).toEqual(bytes("live history"))
    expect(pool.files.has(ROLLBACK_PATH)).toBe(false)
  })

  it("discards an unreadable copy instead of retrying it forever", async () => {
    const pool = createPool({
      [DB_PATH]: bytes("live history"),
      [ROLLBACK_PATH]: bytes("x")
    })
    pool.exportFile = async () => {
      throw new Error("slot is gone")
    }

    await expect(recoverInterruptedImport(pool, DB_PATH)).resolves.toBe(false)
    expect(pool.files.has(ROLLBACK_PATH)).toBe(false)
    expect(pool.files.get(DB_PATH)).toEqual(bytes("live history"))
  })

  it("discards an empty copy", async () => {
    const pool = createPool({
      [DB_PATH]: bytes("live history"),
      [ROLLBACK_PATH]: new Uint8Array()
    })

    await expect(recoverInterruptedImport(pool, DB_PATH)).resolves.toBe(false)
    expect(pool.files.get(DB_PATH)).toEqual(bytes("live history"))
  })
})

describe("clearing the copy", () => {
  it("removes it once a replacement completed", () => {
    const pool = createPool({ [ROLLBACK_PATH]: bytes("live history") })

    clearRollbackCopy(pool)

    expect(pool.files.has(ROLLBACK_PATH)).toBe(false)
  })
})
