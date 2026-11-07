export interface PlannedTest {
  line: string
  weightMs: number
}

export interface PlannedShard<T extends PlannedTest = PlannedTest> {
  shard: number
  weightMs: number
  tests: T[]
}

export function planShards<T extends PlannedTest>(
  tests: T[],
  shardCount: number,
  reservedMs?: Record<string, number>
): PlannedShard<T>[]
