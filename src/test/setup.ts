import { afterEach, beforeEach, vi } from "vitest"
import "@testing-library/jest-dom"
import "fake-indexeddb/auto"

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
    }
  }
} as unknown as typeof chrome

vi.mock("@/lib/plasmo-global-storage", () => ({
  plasmoGlobalStorage: {
    get: vi.fn().mockResolvedValue(undefined),
    set: vi.fn().mockResolvedValue(undefined),
    remove: vi.fn().mockResolvedValue(undefined),
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
