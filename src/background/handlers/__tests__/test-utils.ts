import { vi } from "vitest"
import type { ChromeMessage, ChromePort, SendResponseFunction } from "@/types"

/**
 * Create a mock Ollama API response
 */
export const mockOllamaResponse = (data: unknown, ok = true): Response => {
  return {
    ok,
    status: ok ? 200 : 500,
    statusText: ok ? "OK" : "Internal Server Error",
    json: () => Promise.resolve(data),
    text: () =>
      Promise.resolve(typeof data === "string" ? data : JSON.stringify(data)),
    headers: new Headers(),
    redirected: false,
    type: "basic",
    url: "",
    clone: vi.fn(),
    body: null,
    bodyUsed: false,
    arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)),
    blob: () => Promise.resolve(new Blob()),
    formData: () => Promise.resolve(new FormData()),
    bytes: () => Promise.resolve(new Uint8Array(0))
  } as Response
}

/**
 * Create a mock sendResponse function
 */
export const createMockSendResponse = (): SendResponseFunction => {
  return vi.fn() as SendResponseFunction
}

/**
 * Create a mock Chrome port
 */
export const createMockPort = (name = "test-port"): ChromePort => {
  return {
    name,
    postMessage: vi.fn(),
    disconnect: vi.fn(),
    onDisconnect: {
      addListener: vi.fn(),
      removeListener: vi.fn(),
      hasListener: vi.fn()
    },
    onMessage: {
      addListener: vi.fn(),
      removeListener: vi.fn(),
      hasListener: vi.fn()
    },
    sender: undefined
  } as unknown as ChromePort
}

/**
 * Create a mock isPortClosed function
 */
export const createMockIsPortClosed = (closed = false) => {
  return vi.fn().mockReturnValue(closed)
}

/**
 * Mock Ollama models response
 */
export const mockModelsResponse = {
  models: [
    {
      name: "llama3:latest",
      modified_at: "2024-01-01T00:00:00Z",
      size: 4661211648,
      digest: "abc123"
    },
    {
      name: "mistral:latest",
      modified_at: "2024-01-01T00:00:00Z",
      size: 4109865159,
      digest: "def456"
    }
  ]
}

/**
 * Mock model details response
 */
export const mockModelDetailsResponse = {
  modelfile: "FROM llama3\\nPARAMETER temperature 0.8",
  parameters: "temperature 0.8",
  template: "{{ .Prompt }}",
  details: {
    format: "gguf",
    family: "llama",
    families: ["llama"],
    parameter_size: "8B",
    quantization_level: "Q4_0"
  }
}

/**
 * Create a mock Response object
 */
export const createMockResponse = (
  data: unknown,
  options?: { ok?: boolean; status?: number; statusText?: string }
): Response => {
  const ok = options?.ok ?? true
  return {
    ok,
    status: options?.status ?? (ok ? 200 : 500),
    statusText: options?.statusText ?? (ok ? "OK" : "Internal Server Error"),
    json: vi.fn().mockResolvedValue(data),
    text: vi
      .fn()
      .mockResolvedValue(
        typeof data === "string" ? data : JSON.stringify(data)
      ),
    headers: new Headers(),
    redirected: false,
    type: "basic",
    url: "",
    clone: vi.fn(),
    body: null,
    bodyUsed: false,
    arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)),
    blob: () => Promise.resolve(new Blob()),
    formData: () => Promise.resolve(new FormData()),
    bytes: () => Promise.resolve(new Uint8Array(0))
  } as Response
}

/**
 * Create a mock ChromeMessage
 */
export const createMockMessage = (
  overrides?: Partial<ChromeMessage>
): ChromeMessage => ({
  type: "TEST_MESSAGE",
  ...overrides
})

/**
 * Create a mock streaming Response with body.getReader()
 */
export const createMockStreamResponse = (
  chunks: string[],
  options?: { ok?: boolean }
): Response => {
  const ok = options?.ok ?? true
  let index = 0
  const encoder = new TextEncoder()
  const reader = {
    read: vi.fn().mockImplementation(() => {
      if (index < chunks.length) {
        return Promise.resolve({
          done: false,
          value: encoder.encode(chunks[index++])
        })
      }
      return Promise.resolve({ done: true, value: undefined })
    }),
    cancel: vi.fn(),
    releaseLock: vi.fn(),
    closed: Promise.resolve(undefined)
  }
  return {
    ok,
    status: ok ? 200 : 500,
    statusText: ok ? "OK" : "Internal Server Error",
    body: { getReader: () => reader } as unknown as ReadableStream<Uint8Array>,
    headers: new Headers(),
    redirected: false,
    type: "basic",
    url: "",
    clone: vi.fn(),
    bodyUsed: false,
    json: vi.fn(),
    text: vi.fn(),
    arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)),
    blob: () => Promise.resolve(new Blob()),
    formData: () => Promise.resolve(new FormData()),
    bytes: () => Promise.resolve(new Uint8Array(0))
  } as Response
}

/**
 * Setup common mocks for all handler tests
 */
export const setupHandlerMocks = () => {
  // Mock global fetch
  global.fetch = vi.fn()

  return {
    fetch: global.fetch as ReturnType<typeof vi.fn>
  }
}

/**
 * Clear all mocks
 */
export const clearHandlerMocks = () => {
  vi.clearAllMocks()
}
