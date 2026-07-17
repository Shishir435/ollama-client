import { afterEach, beforeEach, vi } from "vitest"
import "@testing-library/jest-dom"
import "fake-indexeddb/auto"

const testWebLockQueues = new Map<string, Promise<unknown>>()
const requestTestWebLock = vi.fn(
  (name: string, callback: () => Promise<unknown>): Promise<unknown> => {
    const previous = testWebLockQueues.get(name) ?? Promise.resolve()
    const result = previous.then(callback, callback)
    testWebLockQueues.set(
      name,
      result.then(
        () => undefined,
        () => undefined
      )
    )
    return result
  }
)

Object.defineProperty(globalThis.navigator, "locks", {
  configurable: true,
  value: { request: requestTestWebLock }
})

// Mock chrome extension APIs
global.chrome = {
  runtime: {
    id: "test-extension-id",
    getURL: (path: string) => `chrome-extension://test/${path}`
  },
  storage: {
    local: {
      get: vi.fn(),
      set: vi.fn(),
      remove: vi.fn(),
      clear: vi.fn()
    },
    sync: {
      get: vi.fn(),
      set: vi.fn(),
      remove: vi.fn(),
      clear: vi.fn()
    },
    onChanged: {
      addListener: vi.fn(),
      removeListener: vi.fn(),
      hasListener: vi.fn()
    }
  }
} as unknown as typeof chrome

vi.mock("@/lib/plasmo-global-storage", () => ({
  getPlasmoStorageForKey: vi.fn(() => ({
    get: vi.fn().mockResolvedValue(undefined),
    set: vi.fn().mockResolvedValue(undefined),
    remove: vi.fn().mockResolvedValue(undefined),
    clear: vi.fn().mockResolvedValue(undefined),
    watch: vi.fn(),
    unwatch: vi.fn()
  })),
  getPlasmoStoredValue: vi.fn().mockResolvedValue(undefined),
  setPlasmoStoredValue: vi.fn().mockResolvedValue(undefined),
  removePlasmoStoredValue: vi.fn().mockResolvedValue(undefined),
  isDeviceLocalStorageKey: vi.fn().mockReturnValue(false),
  plasmoDeviceStorage: {
    get: vi.fn().mockResolvedValue(undefined),
    set: vi.fn().mockResolvedValue(undefined),
    remove: vi.fn().mockResolvedValue(undefined),
    clear: vi.fn().mockResolvedValue(undefined),
    watch: vi.fn(),
    unwatch: vi.fn()
  },
  plasmoGlobalStorage: {
    get: vi.fn().mockResolvedValue(undefined),
    set: vi.fn().mockResolvedValue(undefined),
    remove: vi.fn().mockResolvedValue(undefined),
    clear: vi.fn().mockResolvedValue(undefined),
    watch: vi.fn()
  }
}))

// Reset mocks after each test
afterEach(() => {
  vi.clearAllMocks()
})

// Setup fake-indexeddb
beforeEach(() => {
  // fake-indexeddb is already set up globally
  // No additional setup needed
})
