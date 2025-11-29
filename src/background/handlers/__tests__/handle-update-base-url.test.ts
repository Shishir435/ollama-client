import { beforeEach, describe, expect, it, vi } from "vitest"
import { handleUpdateBaseUrl } from "../handle-update-base-url"
import { createMockSendResponse, clearHandlerMocks } from "./test-utils"

// Mock browser API
vi.mock("@/lib/browser-api", () => ({
  isChromiumBased: vi.fn()
}))

vi.mock("@/background/lib/utils", () => ({
  safeSendResponse: vi.fn()
}))

// Mock Chrome API
const mockDeclarativeNetRequest = {
  updateDynamicRules: vi.fn().mockResolvedValue(undefined),
  RuleActionType: {
    MODIFY_HEADERS: "modifyHeaders"
  },
  HeaderOperation: {
    SET: "set"
  },
  ResourceType: {
    XMLHTTPREQUEST: "xmlhttprequest"
  }
}

globalThis.chrome = {
  declarativeNetRequest: mockDeclarativeNetRequest
} as any

describe("handleUpdateBaseUrl", () => {
  let mockSendResponse: ReturnType<typeof createMockSendResponse>

  beforeEach(() => {
    clearHandlerMocks()
    mockSendResponse = createMockSendResponse()
    vi.clearAllMocks()
  })

  describe("browser compatibility", () => {
    it("should reject Firefox with appropriate message", async () => {
      const { isChromiumBased } = await import("@/lib/browser-api")
      const { safeSendResponse } = await import("@/background/lib/utils")

      vi.mocked(isChromiumBased).mockReturnValue(false)

      await handleUpdateBaseUrl("http://localhost:11434", mockSendResponse)

      expect(safeSendResponse).toHaveBeenCalledWith(mockSendResponse, {
        success: false,
        error: {
          status: 0,
          message:
            "Firefox requires manual OLLAMA_ORIGINS configuration. See settings for instructions."
        }
      })
    })

    it("should proceed with Chromium-based browsers", async () => {
      const { isChromiumBased } = await import("@/lib/browser-api")
      const { safeSendResponse } = await import("@/background/lib/utils")

      vi.mocked(isChromiumBased).mockReturnValue(true)

      await handleUpdateBaseUrl("http://localhost:11434", mockSendResponse)

      expect(mockDeclarativeNetRequest.updateDynamicRules).toHaveBeenCalled()
      expect(safeSendResponse).toHaveBeenCalledWith(mockSendResponse, {
        success: true
      })
    })
  })

  describe("URL parsing", () => {
    it("should correctly parse and extract origin from URL", async () => {
      const { isChromiumBased } = await import("@/lib/browser-api")
      vi.mocked(isChromiumBased).mockReturnValue(true)

      await handleUpdateBaseUrl("http://192.168.1.100:11434/api", mockSendResponse)

      const callArgs =
        mockDeclarativeNetRequest.updateDynamicRules.mock.calls[0][0]
      const addedRule = callArgs.addRules[0]

      expect(addedRule.action.requestHeaders[0].value).toBe(
        "http://192.168.1.100:11434"
      )
      expect(addedRule.condition.urlFilter).toBe(
        "http://192.168.1.100:11434/*"
      )
    })

    it("should handle URLs without port", async () => {
      const { isChromiumBased } = await import("@/lib/browser-api")
      vi.mocked(isChromiumBased).mockReturnValue(true)

      await handleUpdateBaseUrl("https://ollama.example.com", mockSendResponse)

      const callArgs =
        mockDeclarativeNetRequest.updateDynamicRules.mock.calls[0][0]
      const addedRule = callArgs.addRules[0]

      expect(addedRule.action.requestHeaders[0].value).toBe(
        "https://ollama.example.com"
      )
    })

    it("should handle URLs with different protocols", async () => {
      const { isChromiumBased } = await import("@/lib/browser-api")
      vi.mocked(isChromiumBased).mockReturnValue(true)

      await handleUpdateBaseUrl("https://secure.ollama.com:443", mockSendResponse)

      const callArgs =
        mockDeclarativeNetRequest.updateDynamicRules.mock.calls[0][0]
      const addedRule = callArgs.addRules[0]

      // URL origin does not include default ports (443 for https)
      expect(addedRule.action.requestHeaders[0].value).toBe(
        "https://secure.ollama.com"
      )
    })

    it("should handle invalid URLs", async () => {
      const { isChromiumBased } = await import("@/lib/browser-api")
      const { safeSendResponse } = await import("@/background/lib/utils")

      vi.mocked(isChromiumBased).mockReturnValue(true)

      await handleUpdateBaseUrl("not-a-valid-url", mockSendResponse)

      expect(safeSendResponse).toHaveBeenCalledWith(mockSendResponse, {
        success: false,
        error: {
          status: 0,
          message: expect.stringContaining("Invalid URL")
        }
      })
    })
  })

  describe("declarativeNetRequest rules", () => {
    it("should update dynamic rules with correct configuration", async () => {
      const { isChromiumBased } = await import("@/lib/browser-api")
      vi.mocked(isChromiumBased).mockReturnValue(true)

      await handleUpdateBaseUrl("http://localhost:11434", mockSendResponse)

      expect(mockDeclarativeNetRequest.updateDynamicRules).toHaveBeenCalledWith({
        removeRuleIds: [1],
        addRules: [
          {
            id: 1,
            priority: 1,
            action: {
              type: "modifyHeaders",
              requestHeaders: [
                {
                  header: "Origin",
                  operation: "set",
                  value: "http://localhost:11434"
                }
              ]
            },
            condition: {
              urlFilter: "http://localhost:11434/*",
              resourceTypes: ["xmlhttprequest"]
            }
          }
        ]
      })
    })

    it("should remove previous rule (id: 1) before adding new one", async () => {
      const { isChromiumBased } = await import("@/lib/browser-api")
      vi.mocked(isChromiumBased).mockReturnValue(true)

      await handleUpdateBaseUrl("http://custom.server:8080", mockSendResponse)

      const callArgs =
        mockDeclarativeNetRequest.updateDynamicRules.mock.calls[0][0]

      expect(callArgs.removeRuleIds).toEqual([1])
    })

    it("should set rule priority to 1", async () => {
      const { isChromiumBased } = await import("@/lib/browser-api")
      vi.mocked(isChromiumBased).mockReturnValue(true)

      await handleUpdateBaseUrl("http://localhost:11434", mockSendResponse)

      const callArgs =
        mockDeclarativeNetRequest.updateDynamicRules.mock.calls[0][0]
      const addedRule = callArgs.addRules[0]

      expect(addedRule.priority).toBe(1)
    })

    it("should only target XMLHTTPREQUEST resource type", async () => {
      const { isChromiumBased } = await import("@/lib/browser-api")
      vi.mocked(isChromiumBased).mockReturnValue(true)

      await handleUpdateBaseUrl("http://localhost:11434", mockSendResponse)

      const callArgs =
        mockDeclarativeNetRequest.updateDynamicRules.mock.calls[0][0]
      const addedRule = callArgs.addRules[0]

      expect(addedRule.condition.resourceTypes).toEqual(["xmlhttprequest"])
    })
  })

  describe("success response", () => {
    it("should send success response after successful update", async () => {
      const { isChromiumBased } = await import("@/lib/browser-api")
      const { safeSendResponse } = await import("@/background/lib/utils")

      vi.mocked(isChromiumBased).mockReturnValue(true)
      mockDeclarativeNetRequest.updateDynamicRules.mockResolvedValue(undefined)

      await handleUpdateBaseUrl("http://localhost:11434", mockSendResponse)

      expect(safeSendResponse).toHaveBeenCalledWith(mockSendResponse, {
        success: true
      })
    })
  })

  describe("error handling", () => {
    it("should handle declarativeNetRequest errors", async () => {
      const { isChromiumBased } = await import("@/lib/browser-api")
      const { safeSendResponse } = await import("@/background/lib/utils")

      vi.mocked(isChromiumBased).mockReturnValue(true)
      mockDeclarativeNetRequest.updateDynamicRules.mockRejectedValue(
        new Error("Permission denied")
      )

      await handleUpdateBaseUrl("http://localhost:11434", mockSendResponse)

      expect(safeSendResponse).toHaveBeenCalledWith(mockSendResponse, {
        success: false,
        error: {
          status: 0,
          message: "Permission denied"
        }
      })
    })

    it("should handle unknown error types", async () => {
      const { isChromiumBased } = await import("@/lib/browser-api")
      const { safeSendResponse } = await import("@/background/lib/utils")

      vi.mocked(isChromiumBased).mockReturnValue(true)
      // Cast string to Error-like object
      mockDeclarativeNetRequest.updateDynamicRules.mockRejectedValue(
        { message: "String error" } as Error
      )

      await handleUpdateBaseUrl("http://localhost:11434", mockSendResponse)

      expect(safeSendResponse).toHaveBeenCalledWith(mockSendResponse, {
        success: false,
        error: {
          status: 0,
          message: "String error"
        }
      })
    })

    it("should handle empty URL", async () => {
      const { isChromiumBased } = await import("@/lib/browser-api")
      const { safeSendResponse } = await import("@/background/lib/utils")

      vi.mocked(isChromiumBased).mockReturnValue(true)

      await handleUpdateBaseUrl("", mockSendResponse)

      expect(safeSendResponse).toHaveBeenCalledWith(mockSendResponse, {
        success: false,
        error: expect.objectContaining({
          status: 0
        })
      })
    })

    it("should handle URL parsing errors gracefully", async () => {
      const { isChromiumBased } = await import("@/lib/browser-api")
      const { safeSendResponse } = await import("@/background/lib/utils")

      vi.mocked(isChromiumBased).mockReturnValue(true)

      await handleUpdateBaseUrl("://invalid", mockSendResponse)

      expect(safeSendResponse).toHaveBeenCalledWith(mockSendResponse, {
        success: false,
        error: {
          status: 0,
          message: expect.any(String)
        }
      })
    })
  })

  describe("different URL formats", () => {
    it("should handle localhost URLs", async () => {
      const { isChromiumBased } = await import("@/lib/browser-api")
      vi.mocked(isChromiumBased).mockReturnValue(true)

      await handleUpdateBaseUrl("http://localhost:11434", mockSendResponse)

      const callArgs =
        mockDeclarativeNetRequest.updateDynamicRules.mock.calls[0][0]
      const addedRule = callArgs.addRules[0]

      expect(addedRule.action.requestHeaders[0].value).toBe(
        "http://localhost:11434"
      )
    })

    it("should handle 127.0.0.1 URLs", async () => {
      const { isChromiumBased } = await import("@/lib/browser-api")
      vi.mocked(isChromiumBased).mockReturnValue(true)

      await handleUpdateBaseUrl("http://127.0.0.1:11434", mockSendResponse)

      const callArgs =
        mockDeclarativeNetRequest.updateDynamicRules.mock.calls[0][0]
      const addedRule = callArgs.addRules[0]

      expect(addedRule.action.requestHeaders[0].value).toBe(
        "http://127.0.0.1:11434"
      )
    })

    it("should handle LAN IP addresses", async () => {
      const { isChromiumBased } = await import("@/lib/browser-api")
      vi.mocked(isChromiumBased).mockReturnValue(true)

      await handleUpdateBaseUrl("http://192.168.1.5:11434", mockSendResponse)

      const callArgs =
        mockDeclarativeNetRequest.updateDynamicRules.mock.calls[0][0]
      const addedRule = callArgs.addRules[0]

      expect(addedRule.action.requestHeaders[0].value).toBe(
        "http://192.168.1.5:11434"
      )
    })

    it("should handle domain names", async () => {
      const { isChromiumBased } = await import("@/lib/browser-api")
      vi.mocked(isChromiumBased).mockReturnValue(true)

      await handleUpdateBaseUrl(
        "https://ollama.myserver.com:8080",
        mockSendResponse
      )

      const callArgs =
        mockDeclarativeNetRequest.updateDynamicRules.mock.calls[0][0]
      const addedRule = callArgs.addRules[0]

      expect(addedRule.action.requestHeaders[0].value).toBe(
        "https://ollama.myserver.com:8080"
      )
    })
  })
})
