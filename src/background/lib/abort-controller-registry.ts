const controllerMap = new Map<string, AbortController>()

export function setAbortController(key: string, controller: AbortController) {
  controllerMap.set(key, controller)
}

export function getAbortController(key: string): AbortController | undefined {
  return controllerMap.get(key)
}

export function clearAbortController(key: string) {
  controllerMap.delete(key)
}

export function abortAndClearController(key: string) {
  const controller = controllerMap.get(key)
  if (controller) {
    controller.abort()
    controllerMap.delete(key)
  }
}

export function hasAbortController(key: string): boolean {
  return controllerMap.has(key)
}
