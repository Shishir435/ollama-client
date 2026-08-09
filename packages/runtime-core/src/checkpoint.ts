/** Injectable time source for deterministic runtime transitions. */
export interface RuntimeClock {
  now: () => number
}

/** Persistence port used after a checkpoint transition is computed. */
export type CheckpointWriter<T> = (value: T) => Promise<void>

const systemClock: RuntimeClock = { now: () => Date.now() }

/**
 * Apply a state patch, stamp it, persist the complete snapshot, and return the
 * exact value written. The helper has no knowledge of the storage adapter.
 */
export const writeCheckpoint = async <T extends { updatedAt: number }>(
  current: T,
  patch: Partial<T>,
  writer: CheckpointWriter<T>,
  clock: RuntimeClock = systemClock
): Promise<T> => {
  const updated = { ...current, ...patch, updatedAt: clock.now() }
  await writer(updated)
  return updated
}
