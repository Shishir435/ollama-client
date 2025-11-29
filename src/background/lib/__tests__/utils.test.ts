import { beforeEach, describe, expect, it, vi } from "vitest"
import {
  getBaseUrl,
  getPullAbortControllerKey,
  safePostMessage,
  safeSendResponse
} from "../utils"
import { browser } from "@/lib/browser-api"
import { plasmoGlobalStorage } from "@/lib/plasmo-global-storage"
import { STORAGE_KEYS } from "@/lib/constants"

// Mock dependencies
vi.mock("@/lib/browser-api", () => ({
  browser: {
    runtime: {
      lastError: null
    }
  }
}))

vi.mock("@/lib/plasmo-global-storage", () => ({
  plasmoGlobalStorage: {
    get: vi.fn()
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
      const port = { postMessage: vi.fn() } as any
      const message = { delta: "test" } as any

      safePostMessage(port, message)

      expect(port.postMessage).toHaveBeenCalledWith(message)
    })

    it("should handle port disconnect (runtime.lastError)", () => {
      const port = {
        postMessage: vi.fn().mockImplementation(() => {
          throw new Error("Port disconnected")
        })
      } as any
      ;(browser.runtime as any).lastError = { message: "Port disconnected" }
      const consoleSpy = vi.spyOn(console, "debug").mockImplementation(() => {})

      safePostMessage(port, { delta: "test" } as any)

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("channel may be closed"),
        "Port disconnected"
      )
    })

    it("should handle other errors", () => {
      const error = new Error("Random error")
      const port = {
        postMessage: vi.fn().mockImplementation(() => {
          throw error
        })
      } as any
      const consoleSpy = vi.spyOn(console, "debug").mockImplementation(() => {})

      safePostMessage(port, { delta: "test" } as any)

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("Could not send message"),
        error
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
      const consoleSpy = vi.spyOn(console, "debug").mockImplementation(() => {})

      safeSendResponse(sendResponse, { success: true })

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("channel may be closed"),
        "Channel closed"
      )
    })
  })

  describe("getBaseUrl", () => {
    it("should return stored URL", async () => {
      vi.mocked(plasmoGlobalStorage.get).mockResolvedValue("http://custom:11434")

      const url = await getBaseUrl()

      expect(url).toBe("http://custom:11434")
      expect(plasmoGlobalStorage.get).toHaveBeenCalledWith(STORAGE_KEYS.OLLAMA.BASE_URL)
    })

    it("should return default URL if not stored", async () => {
      vi.mocked(plasmoGlobalStorage.get).mockResolvedValue(undefined)

      const url = await getBaseUrl()

      expect(url).toBe("http://localhost:11434")
    })
  })

  describe("getPullAbortControllerKey", () => {
    it("should generate correct key", () => {
      expect(getPullAbortControllerKey("port1", "llama2")).toBe("port1:llama2")
    })
  })
})
