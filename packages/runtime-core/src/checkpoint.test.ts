import { describe, expect, it, vi } from "vitest"
import { writeCheckpoint } from "./checkpoint"

describe("writeCheckpoint", () => {
  it("persists and returns the same timestamped transition", async () => {
    const writer = vi.fn(async () => {})
    const updated = await writeCheckpoint(
      { id: "job", status: "queued", updatedAt: 1 },
      { status: "running" },
      writer,
      { now: () => 42 }
    )

    expect(updated).toEqual({ id: "job", status: "running", updatedAt: 42 })
    expect(writer).toHaveBeenCalledWith(updated)
  })

  it("does not report a transition when persistence fails", async () => {
    await expect(
      writeCheckpoint(
        { status: "queued", updatedAt: 1 },
        { status: "running" },
        async () => {
          throw new Error("write failed")
        },
        { now: () => 42 }
      )
    ).rejects.toThrow("write failed")
  })
})
