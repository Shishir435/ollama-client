import { describe, expect, it } from "vitest"
import { planShards } from "../../tools/verify/lib/critical-shard-plan.mjs"

const tests = (count: number, weightMs = 10_000) =>
  Array.from({ length: count }, (_, index) => ({
    line: `test ${String(index).padStart(2, "0")}`,
    weightMs
  }))

/**
 * The planner decides which tests share a runner, and the last shard to finish
 * sets the browser stage's length. Shard 1 also runs work the test list cannot
 * show, so it starts with weight it has already carried; these pin that the
 * packing honours that rather than only that the number sits in a file.
 */
describe("critical shard planning", () => {
  it("splits equal tests evenly when no shard carries anything", () => {
    const shards = planShards(tests(8), 2)

    expect(shards.map((shard) => shard.tests.length)).toEqual([4, 4])
  })

  it("gives the shard that carries extra work fewer tests", () => {
    const shards = planShards(tests(8), 2, { "1": 20_000 })

    expect(shards.map((shard) => shard.tests.length)).toEqual([3, 5])
    expect(shards[0]?.weightMs).toBe(shards[1]?.weightMs)
  })

  it("reads the reserve by the shard's 1-based number", () => {
    const shards = planShards(tests(8), 2, { "2": 20_000 })

    expect(shards.map((shard) => shard.tests.length)).toEqual([5, 3])
  })

  it("ignores a reserve for a shard that does not exist", () => {
    const shards = planShards(tests(8), 2, { "3": 90_000 })

    expect(shards.map((shard) => shard.tests.length)).toEqual([4, 4])
  })

  it("places every test on exactly one shard", () => {
    const input = [
      ...tests(5, 30_000),
      ...tests(7, 4_000).map((test) => ({
        ...test,
        line: `short ${test.line}`
      }))
    ]
    const shards = planShards(input, 4, { "1": 26_000 })
    const placed = shards.flatMap((shard) =>
      shard.tests.map((test) => test.line)
    )

    expect(placed).toHaveLength(input.length)
    expect(new Set(placed).size).toBe(input.length)
  })

  it("is deterministic and leaves the caller's list in order", () => {
    const input = tests(9)
    const reversed = [...input].reverse()
    const snapshot = input.map((test) => test.line)

    const first = planShards(input, 3, { "1": 5_000 })
    const second = planShards(reversed, 3, { "1": 5_000 })

    expect(input.map((test) => test.line)).toEqual(snapshot)
    expect(first.map((shard) => shard.tests.map((test) => test.line))).toEqual(
      second.map((shard) => shard.tests.map((test) => test.line))
    )
  })
})
