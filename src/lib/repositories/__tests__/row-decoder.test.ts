import { beforeEach, describe, expect, it, vi } from "vitest"
import { z } from "zod"

const warn = vi.hoisted(() => vi.fn())
vi.mock("@/lib/logger", () => ({
  logger: { warn, error: vi.fn(), info: vi.fn(), debug: vi.fn() }
}))

import { decodeRow, decodeRows, type RowDecodeContext } from "../row-decoder"

const RowSchema = z.object({
  id: z.string(),
  status: z.enum(["queued", "running"]),
  content: z.string(),
  updatedAt: z.number()
})

// A real table from `DURABLE_TABLES`: the context type is the shared union,
// so an invented name no longer typechecks.
const context: RowDecodeContext = {
  table: "ingestion_runs",
  operation: "read"
}

const row = (overrides: Record<string, unknown> = {}) => ({
  id: "run-1",
  status: "queued",
  content: "a private message body",
  updatedAt: 5,
  ...overrides
})

beforeEach(() => {
  warn.mockClear()
})

describe("row decoder", () => {
  it("returns a row that matches and nothing else", () => {
    expect(decodeRow(RowSchema, row(), context)).toEqual(row())
    expect(warn).not.toHaveBeenCalled()
  })

  it("refuses a row whose column is missing or the wrong type", () => {
    expect(decodeRow(RowSchema, row({ updatedAt: "5" }), context)).toBeNull()
    expect(decodeRow(RowSchema, { id: "run-1" }, context)).toBeNull()
    // The shape a half-applied migration or a newer build produces: a value
    // this version has never heard of in a column it thought was closed.
    expect(decodeRow(RowSchema, row({ status: "paused" }), context)).toBeNull()
  })

  it("never records a stored value, only where the shape broke", () => {
    decodeRow(RowSchema, row({ status: "paused", content: "SECRET" }), context)

    const [message, scope, meta] = warn.mock.calls[0]
    const serialized = JSON.stringify({ message, scope, meta })
    // A Zod message for an enum mismatch embeds the received value, which is
    // exactly the column we have just decided we cannot vouch for.
    expect(serialized).not.toContain("SECRET")
    expect(serialized).not.toContain("paused")
    expect(serialized).not.toContain("a private message body")
    // The row id is ours, so it stays: without it a dropped row is untraceable.
    expect(meta).toMatchObject({
      table: "ingestion_runs",
      operation: "read",
      rowId: "run-1",
      issues: ["status:invalid_value"]
    })
  })

  it("keeps the readable rows when one in a batch is not", () => {
    // One bad checkpoint must not deny recovery every other job in the list.
    const decoded = decodeRows(
      RowSchema,
      [row({ id: "a" }), row({ id: "b", updatedAt: null }), row({ id: "c" })],
      context
    )

    expect(decoded.map((value) => value.id)).toEqual(["a", "c"])
    expect(warn).toHaveBeenCalledTimes(1)
  })

  it("caps how many issues one bad row can log", () => {
    decodeRow(RowSchema, {}, context)

    const meta = warn.mock.calls[0][2] as { issues: string[] }
    expect(meta.issues.length).toBeLessThanOrEqual(5)
  })
})
