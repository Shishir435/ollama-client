/**
 * Packs tests into shards by their expected duration.
 *
 * Longest test first, each onto whichever shard is lightest so far. A shard may
 * start with weight it has already carried: work it does beside its tests that
 * the test list cannot show, such as the service-worker recovery checks and the
 * retrieval benchmark that run only on shard 1. Without that head start the
 * shard that carries them finishes last, which it did on most runs.
 *
 * @param {{ line: string, weightMs: number }[]} tests
 * @param {number} shardCount
 * @param {Record<string, number>} [reservedMs] weight carried, by 1-based shard
 */
export const planShards = (tests, shardCount, reservedMs = {}) => {
  const bins = Array.from({ length: shardCount }, (_, index) => ({
    shard: index + 1,
    weightMs: Number(reservedMs[String(index + 1)] ?? 0),
    tests: []
  }))

  for (const test of [...tests].sort(
    (left, right) =>
      right.weightMs - left.weightMs || left.line.localeCompare(right.line)
  )) {
    const bin = bins.reduce((lightest, candidate) =>
      candidate.weightMs < lightest.weightMs ? candidate : lightest
    )
    bin.tests.push(test)
    bin.weightMs += test.weightMs
  }

  return bins
}
