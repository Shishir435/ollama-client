import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const sendMessage = vi.hoisted(() => vi.fn())

vi.mock("@/lib/browser-api", () => ({
  browser: { runtime: { sendMessage } }
}))

import { extensionRpcClient } from "../extension-client"
import {
  RPC_CANCEL_MESSAGE_TYPE,
  RPC_PROTOCOL_VERSION,
  RPC_RESPONSE_MESSAGE_TYPE,
  RpcErrorCode,
  RpcMethod
} from "../rpc"

beforeEach(() => {
  sendMessage.mockReset()
})

afterEach(() => {
  vi.useRealTimers()
})

describe("extension RPC client", () => {
  it("sends a versioned request and validates its typed response", async () => {
    sendMessage.mockImplementation(async (message) => ({
      type: RPC_RESPONSE_MESSAGE_TYPE,
      version: RPC_PROTOCOL_VERSION,
      requestId: message.requestId,
      ok: true,
      result: { providers: [] }
    }))

    await expect(
      extensionRpcClient.call(RpcMethod.ProvidersList, {})
    ).resolves.toEqual({ providers: [] })
    expect(sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "app-rpc-request",
        version: 1,
        method: RpcMethod.ProvidersList,
        requestId: expect.any(String),
        request: {}
      })
    )
  })

  it("rejects invalid payloads before crossing the browser boundary", async () => {
    await expect(
      extensionRpcClient.call(RpcMethod.ProvidersListModels, {
        providerId: ""
      })
    ).rejects.toMatchObject({ kind: "validation", status: 400 })
    expect(sendMessage).not.toHaveBeenCalled()
  })

  it("accepts normalized model catalogs with sparse provider metadata", async () => {
    sendMessage.mockImplementation(async (message) => ({
      type: RPC_RESPONSE_MESSAGE_TYPE,
      version: RPC_PROTOCOL_VERSION,
      requestId: message.requestId,
      ok: true,
      result: {
        models: [
          {
            name: "gemma4:latest",
            model: "gemma4:latest",
            modified_at: "",
            size: 0,
            digest: "",
            providerId: "ollama",
            providerName: "Ollama",
            details: {
              parent_model: "",
              format: "gguf",
              family: "gemma4",
              families: [],
              parameter_size: "",
              quantization_level: ""
            }
          }
        ],
        failures: []
      }
    }))

    await expect(
      extensionRpcClient.call(RpcMethod.ProvidersListModels, {
        enabledOnly: true
      })
    ).resolves.toMatchObject({
      models: [{ name: "gemma4:latest", providerId: "ollama" }],
      failures: []
    })
  })

  it("converts RPC error envelopes into localized AppErrors", async () => {
    sendMessage.mockImplementation(async (message) => ({
      type: RPC_RESPONSE_MESSAGE_TYPE,
      version: RPC_PROTOCOL_VERSION,
      requestId: message.requestId,
      ok: false,
      error: {
        code: RpcErrorCode.ProviderFailed,
        status: 429,
        fallbackMessage: "Rate limited",
        messageKey: "errors.rpc.provider_failed",
        retryable: true,
        retryAfterMs: 5000,
        providerId: "remote",
        supportCode: "RPC-PROVIDER-FAILED-12345678"
      }
    }))

    await expect(
      extensionRpcClient.call(RpcMethod.ProvidersTestConnection, {
        target: "stored",
        providerId: "remote"
      })
    ).rejects.toMatchObject({
      status: 429,
      messageKey: "errors.rpc.provider_failed",
      retryable: true,
      retryAfterMs: 5000,
      providerId: "remote",
      context: "RPC-PROVIDER-FAILED-12345678"
    })
  })

  it("normalizes worker transport failures without exposing browser errors", async () => {
    sendMessage.mockRejectedValue(
      new Error("Could not establish connection: sensitive transport detail")
    )

    await expect(
      extensionRpcClient.call(RpcMethod.ProvidersList, {})
    ).rejects.toMatchObject({
      status: 503,
      messageKey: "errors.rpc.internal",
      userMessage: "The background request failed. Please try again.",
      retryable: true
    })
  })

  it("times out a worker request that never settles", async () => {
    vi.useFakeTimers()
    sendMessage.mockImplementation((message) =>
      message.type === RPC_CANCEL_MESSAGE_TYPE
        ? Promise.resolve({ success: true, cancelled: true })
        : new Promise(() => undefined)
    )

    const rejection = expect(
      extensionRpcClient.call(RpcMethod.ProvidersList, {})
    ).rejects.toMatchObject({
      status: 408,
      messageKey: "errors.rpc.timeout",
      retryable: true
    })
    await vi.advanceTimersByTimeAsync(5_000)
    await rejection

    const requestId = sendMessage.mock.calls[0][0].requestId
    expect(sendMessage).toHaveBeenNthCalledWith(2, {
      type: RPC_CANCEL_MESSAGE_TYPE,
      version: RPC_PROTOCOL_VERSION,
      requestId
    })
  })
})
