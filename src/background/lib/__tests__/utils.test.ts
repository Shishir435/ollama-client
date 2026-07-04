import { beforeEach, describe, expect, it, vi } from "vitest"
import { createMockPort } from "@/background/handlers/__tests__/test-utils"
import { browser } from "@/lib/browser-api"
import { logger } from "@/lib/logger"
import { ProviderManager } from "@/lib/providers/manager"
import type { ChatStreamMessage } from "@/types"
import {
  getBaseUrl,
  getPullAbortControllerKey,
  safePostMessage,
  safeSendResponse
} from "../utils"

// Mock dependencies
vi.mock("@/lib/browser-api", () => ({
  browser: {
    runtime: {
      lastError: null
    }
  }
}))

vi.mock("@/lib/logger", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  }
}))

vi.mock("@/lib/providers/manager", () => ({
  ProviderManager: {
    getProviderConfig: vi.fn()
  }
}))

describe("Background Utils", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Reset browser.runtime.lastError
    ;(browser.runtime as any).lastError = null
  })

  describe("safePostMessage", () => {
    it("should post message to port", () => {
      const port = createMockPort()
      const message: ChatStreamMessage = { delta: "test" }

      safePostMessage(port, message)

      expect(port.postMessage).toHaveBeenCalledWith(message)
    })

    it("should handle port disconnect (runtime.lastError)", () => {
      const port = createMockPort()
      vi.mocked(port.postMessage).mockImplementation(() => {
        throw new Error("Port disconnected")
      })
      ;(browser.runtime as any).lastError = { message: "Port disconnected" }

      safePostMessage(port, { delta: "test" })

      expect(logger.debug).toHaveBeenCalledWith(
        expect.stringContaining("channel may be closed"),
        "BackgroundUtils",
        { error: "Port disconnected" }
      )
    })

    it("should handle other errors", () => {
      const error = new Error("Random error")
      const port = createMockPort()
      vi.mocked(port.postMessage).mockImplementation(() => {
        throw error
      })

      safePostMessage(port, { delta: "test" })

      expect(logger.debug).toHaveBeenCalledWith(
        expect.stringContaining("Could not send message"),
        "BackgroundUtils",
        { error }
      )
    })
  })

  describe("safeSendResponse", () => {
    it("should send response", () => {
      const sendResponse = vi.fn()
      const response = { success: true }

      safeSendResponse(sendResponse, response)

      expect(sendResponse).toHaveBeenCalledWith(response)
    })

    it("should handle closed channel", () => {
      const sendResponse = vi.fn().mockImplementation(() => {
        throw new Error("Channel closed")
      })
      ;(browser.runtime as any).lastError = { message: "Channel closed" }

      safeSendResponse(sendResponse, { success: true })

      expect(logger.debug).toHaveBeenCalledWith(
        expect.stringContaining("channel may be closed"),
        "BackgroundUtils",
        { error: "Channel closed" }
      )
    })
  })

  describe("getBaseUrl", () => {
    it("should return stored URL", async () => {
      vi.mocked(ProviderManager.getProviderConfig).mockResolvedValue({
        id: "ollama",
        name: "Ollama",
        type: "ollama",
        enabled: true,
        baseUrl: "http://custom:11434/"
      } as never)

      const url = await getBaseUrl()

      expect(url).toBe("http://custom:11434")
    })

    it("should return default URL if not stored", async () => {
      vi.mocked(ProviderManager.getProviderConfig).mockResolvedValue({
        id: "ollama",
        name: "Ollama",
        type: "ollama",
        enabled: true,
        baseUrl: ""
      } as never)

      const url = await getBaseUrl()

      expect(url).toBe("http://localhost:11434")
    })

    it("rejects a missing canonical provider config", async () => {
      vi.mocked(ProviderManager.getProviderConfig).mockResolvedValue(undefined)
      await expect(getBaseUrl()).rejects.toThrow(
        "Ollama provider configuration is missing"
      )
    })
  })

  describe("getPullAbortControllerKey", () => {
    it("should generate correct key", () => {
      expect(getPullAbortControllerKey("port1", "llama2")).toBe("port1:llama2")
    })
  })
})
