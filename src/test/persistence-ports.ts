import type { DataPort } from "@/lib/persistence/port-channel"
/** Paired ports that retain JSON serialization and asynchronous delivery. */
export const portPair = () => {
  const messages = [
    new Set<(message: unknown) => void>(),
    new Set<(message: unknown) => void>()
  ]
  const disconnects = [new Set<() => void>(), new Set<() => void>()]
  let disconnected = false
  const frames: unknown[] = []
  const ports = [0, 1].map((index): DataPort => ({
    name: "persistence-data-v1",
    postMessage(message) {
      if (disconnected) throw new Error("Disconnected")
      const wire: unknown = JSON.parse(JSON.stringify(message))
      frames.push(wire)
      queueMicrotask(() =>
        messages[1 - index].forEach((listener) => listener(wire))
      )
    },
    disconnect() {
      if (disconnected) return
      disconnected = true
      queueMicrotask(() =>
        disconnects.forEach((listeners) =>
          listeners.forEach((listener) => listener())
        )
      )
    },
    onMessage: {
      addListener: (listener) => {
        messages[index].add(listener)
      },
      removeListener: (listener) => {
        messages[index].delete(listener)
      }
    },
    onDisconnect: {
      addListener: (listener) => {
        disconnects[index].add(listener)
      },
      removeListener: (listener) => {
        disconnects[index].delete(listener)
      }
    }
  }))
  return { ports, frames, messages, disconnects }
}
