/** Minimal cancellation handle accepted by the keyed registry. */
export interface Abortable {
  abort: () => void
}

/** Owns keyed cancellation handles without knowing their transport or task. */
export class CancellationRegistry<T extends Abortable = AbortController> {
  readonly #entries = new Map<string, T>()

  set(key: string, controller: T | null): void {
    if (controller === null) this.#entries.delete(key)
    else this.#entries.set(key, controller)
  }

  get(key: string): T | undefined {
    return this.#entries.get(key)
  }

  has(key: string): boolean {
    return this.#entries.has(key)
  }

  clear(key: string): void {
    this.#entries.delete(key)
  }

  abortAndClear(key: string): boolean {
    const controller = this.#entries.get(key)
    if (!controller) return false
    controller.abort()
    this.#entries.delete(key)
    return true
  }
}

/** Observable lifecycle for a timeout-driven cancellation. */
export interface AbortTimeout {
  /** Cancel the pending abort timer. Safe to call multiple times. */
  clear: () => void
  /** True only when this timer initiated cancellation. */
  timedOut: () => boolean
}

/** Arm a timeout without conflating external cancellation with expiry. */
export const createAbortTimeout = (
  controller: Abortable,
  ms: number
): AbortTimeout => {
  let didTimeout = false
  const id = setTimeout(() => {
    didTimeout = true
    controller.abort()
  }, ms)
  return {
    clear: () => clearTimeout(id),
    timedOut: () => didTimeout
  }
}
