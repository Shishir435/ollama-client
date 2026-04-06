const controllerMap = new Map<string, AbortController>()

export const setAbortController = (
  key: string,
  controller: AbortController | null
) => {
  if (controller === null) {
    controllerMap.delete(key)
  } else {
    controllerMap.set(key, controller)
  }
}

export const getAbortController = (
  key: string
): AbortController | undefined => {
  return controllerMap.get(key)
}

export const clearAbortController = (key: string) => {
  controllerMap.delete(key)
}

export const abortAndClearController = (key: string) => {
  const controller = controllerMap.get(key)
  if (controller) {
    controller.abort()
    controllerMap.delete(key)
  }
}

export const hasAbortController = (key: string): boolean => {
  return controllerMap.has(key)
}
