import { CancellationRegistry } from "@ollama-client/runtime-core/cancellation"

const controllers = new CancellationRegistry<AbortController>()

export const setAbortController = (
  key: string,
  controller: AbortController | null
) => {
  if (controller === null) {
    controllers.clear(key)
  } else {
    controllers.set(key, controller)
  }
}

export const getAbortController = (
  key: string
): AbortController | undefined => {
  return controllers.get(key)
}

export const clearAbortController = (key: string) => {
  controllers.clear(key)
}

export const abortAndClearController = (key: string) => {
  controllers.abortAndClear(key)
}

export const hasAbortController = (key: string): boolean => {
  return controllers.has(key)
}
