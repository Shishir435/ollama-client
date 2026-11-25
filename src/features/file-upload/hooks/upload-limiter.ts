/**
 * Runs at most `limit` tasks at once and starts the rest in submission order.
 * A finished task hands its slot straight to the next waiter, so a task
 * submitted in between cannot jump the queue or exceed the limit.
 */
export const createUploadLimiter = (limit: number) => {
  let active = 0
  const waiting: Array<() => void> = []

  return async <T>(task: () => Promise<T>): Promise<T> => {
    if (active >= limit) await new Promise<void>((r) => waiting.push(r))
    else active += 1
    try {
      return await task()
    } finally {
      const next = waiting.shift()
      if (next) next()
      else active -= 1
    }
  }
}
