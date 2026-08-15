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

/** Shared Chrome extension API mock for unit tests. */
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

/**
 * Production code reaches extension APIs through `browser`
 * (webextension-polyfill), never the `chrome` alias — see the contract test in
 * src/lib/__tests__/browser-api-contract.test.ts for why. Point the global at
 * the same mock object so a test that configures chrome.storage.local.get is
 * configuring the API the code under test actually calls.
 *
 * This deliberately makes the two indistinguishable in unit tests. The real
 * difference only shows up in a browser, so the guard against reintroducing
 * `chrome` is the contract test, not this mock.
 */
;(globalThis as { browser?: unknown }).browser = global.chrome

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

/** Prevent mock state from leaking between tests. */
afterEach(() => {
  vi.clearAllMocks()
})

/**
 * Drop module-level caches that outlive a test.
 *
 * The embedding config is memoized until `storage.onChanged` fires. Tests
 * reconfigure it by swapping the `getPlasmoStoredValue` mock, which bypasses
 * storage and so emits no event — the memo would then serve the previous
 * test's value. Production has the event; only the test double does not.
 *
 * Guarded because a handful of suites replace this module with `vi.mock`;
 * reading a name their factory does not define throws rather than yielding
 * undefined. Those suites stub the config outright and need no reset.
 */
beforeEach(async () => {
  try {
    const embeddingConfig = (await import("@/lib/embeddings/config")) as {
      resetEmbeddingConfigCache?: () => void
    }
    embeddingConfig.resetEmbeddingConfigCache?.()
  } catch {
    // Module is mocked without the reset export.
  }
})

/** Reset per-test IndexedDB state supplied by fake-indexeddb. */
beforeEach(() => {
  // fake-indexeddb is already set up globally
  // No additional setup needed
})
