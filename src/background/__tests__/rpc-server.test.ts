import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  testConnection: vi.fn(),
  listModels: vi.fn(),
  upsert: vi.fn(),
  remove: vi.fn(),
  probeModelCapabilities: vi.fn(),
  info: vi.fn(),
  error: vi.fn()
}))

vi.mock("@/lib/providers/provider-rpc-service", () => ({
  ProviderRpcService: {
    list: mocks.list,
    testConnection: mocks.testConnection,
    listModels: mocks.listModels,
    upsert: mocks.upsert,
    remove: mocks.remove,
    probeModelCapabilities: mocks.probeModelCapabilities
  }
}))

vi.mock("@/lib/logger", () => ({
  logger: {
    info: mocks.info,
    error: mocks.error
  }
}))

import {
  handleRpcCancellation,
  handleRpcRequest
} from "@/background/rpc-server"
import { createAppError } from "@/lib/error-utils"
import {
  RPC_CANCEL_MESSAGE_TYPE,
  RPC_PROTOCOL_VERSION,
  RPC_REQUEST_MESSAGE_TYPE,
  RpcErrorCode,
  RpcMethod
} from "@/protocol/rpc"

const extensionId = "test-extension-id"
const extensionPrefix = "chrome-extension://test-extension-id/"
const extensionSender = {
  id: extensionId,
  url: `${extensionPrefix}options.html`
}
const request = (method: RpcMethod, payload: unknown) => ({
  type: RPC_REQUEST_MESSAGE_TYPE,
  version: RPC_PROTOCOL_VERSION,
  requestId: crypto.randomUUID(),
  method,
  request: payload
})

beforeEach(() => {
  vi.clearAllMocks()
  mocks.list.mockResolvedValue({ providers: [] })
  mocks.testConnection.mockResolvedValue({
    providerId: "ollama",
    reachable: true,
    modelCount: 1,
    latencyMs: 4
  })
  mocks.listModels.mockResolvedValue({ models: [], failures: [] })
  mocks.upsert.mockResolvedValue({
    provider: {
      id: "custom:openai:test",
      type: "openai",
      enabled: true,
      name: "Test",
      hasApiKey: false
    }
  })
  mocks.remove.mockResolvedValue({ removedProviderId: "custom:openai:test" })
  mocks.probeModelCapabilities.mockResolvedValue({
    toolCalling: true,
    probedAt: 1
  })
})

describe("RPC server", () => {
  it("validates and dispatches a typed provider request", async () => {
    const envelope = request(RpcMethod.ProvidersList, {})
    const sendResponse = vi.fn()

    await handleRpcRequest(
      envelope,
      extensionSender,
      extensionId,
      extensionPrefix,
      sendResponse
    )

    expect(mocks.list).toHaveBeenCalledOnce()
    expect(sendResponse).toHaveBeenCalledWith({
      type: "app-rpc-response",
      version: 1,
      requestId: envelope.requestId,
      ok: true,
      result: { providers: [] }
    })
  })

  it("normalizes sparse provider models to the public wire shape", async () => {
    mocks.listModels.mockResolvedValue({
      models: [
        {
          name: "future-model",
          size: 1,
          family: "future",
          futureField: "provider-owned",
          details: { futureDetail: true }
        }
      ],
      failures: []
    })
    const envelope = request(RpcMethod.ProvidersListModels, {})
    const sendResponse = vi.fn()

    await handleRpcRequest(
      envelope,
      extensionSender,
      extensionId,
      extensionPrefix,
      sendResponse
    )

    const result = sendResponse.mock.calls[0][0].result
    expect(result.models[0]).toEqual({
      name: "future-model",
      model: "future-model",
      modified_at: "",
      size: 1,
      digest: "",
      details: {
        parent_model: "",
        format: "",
        family: "future",
        families: ["future"],
        parameter_size: "",
        quantization_level: ""
      }
    })
  })

  it("rejects malformed method payloads before invoking a handler", async () => {
    const envelope = request(RpcMethod.ProvidersListModels, {
      providerId: ""
    })
    const sendResponse = vi.fn()

    await handleRpcRequest(
      envelope,
      extensionSender,
      extensionId,
      extensionPrefix,
      sendResponse
    )

    expect(mocks.listModels).not.toHaveBeenCalled()
    expect(sendResponse.mock.calls[0][0]).toMatchObject({
      requestId: envelope.requestId,
      ok: false,
      error: { code: RpcErrorCode.InvalidRequest, status: 400 }
    })
  })

  it("rejects provider RPC from content scripts", async () => {
    const envelope = request(RpcMethod.ProvidersList, {})
    const sendResponse = vi.fn()

    await handleRpcRequest(
      envelope,
      {
        id: extensionId,
        tab: { id: 4 },
        url: "https://example.test"
      } as never,
      extensionId,
      extensionPrefix,
      sendResponse
    )

    expect(mocks.list).not.toHaveBeenCalled()
    expect(sendResponse.mock.calls[0][0]).toMatchObject({
      ok: false,
      error: { code: RpcErrorCode.Forbidden, status: 403 }
    })
  })

  it("dispatches capability probes only through the typed command", async () => {
    const envelope = request(RpcMethod.ProvidersProbeModelCapabilities, {
      providerId: "custom:openai:test",
      modelName: "tool-model"
    })
    const sendResponse = vi.fn()

    await handleRpcRequest(
      envelope,
      extensionSender,
      extensionId,
      extensionPrefix,
      sendResponse
    )

    expect(mocks.probeModelCapabilities).toHaveBeenCalledWith(
      {
        providerId: "custom:openai:test",
        modelName: "tool-model"
      },
      expect.anything()
    )
    expect(sendResponse.mock.calls[0][0]).toMatchObject({
      ok: true,
      result: { toolCalling: true, probedAt: 1 }
    })
  })

  it("returns safe provider errors without logging upstream bodies", async () => {
    mocks.testConnection.mockRejectedValue(
      createAppError("upstream echoed apiKey=private-value", {
        kind: "provider",
        status: 401,
        providerId: "remote",
        userMessage: "Authentication failed"
      })
    )
    const envelope = request(RpcMethod.ProvidersTestConnection, {
      target: "stored",
      providerId: "remote"
    })
    const sendResponse = vi.fn()

    await handleRpcRequest(
      envelope,
      extensionSender,
      extensionId,
      extensionPrefix,
      sendResponse
    )

    const serializedResponse = JSON.stringify(sendResponse.mock.calls[0][0])
    const serializedLogs = JSON.stringify([
      ...mocks.info.mock.calls,
      ...mocks.error.mock.calls
    ])
    expect(serializedResponse).toContain("Authentication failed")
    expect(serializedResponse).not.toContain("private-value")
    expect(serializedLogs).not.toContain("private-value")
  })

  it("aborts an active provider request when the client cancels", async () => {
    let receivedSignal: AbortSignal | undefined
    mocks.listModels.mockImplementation(
      async (_request: unknown, signal: AbortSignal) => {
        receivedSignal = signal
        await new Promise((_resolve, reject) => {
          signal.addEventListener("abort", () => {
            reject(new DOMException("Cancelled", "AbortError"))
          })
        })
        return { models: [], failures: [] }
      }
    )
    const envelope = request(RpcMethod.ProvidersListModels, {})
    const requestResponse = vi.fn()
    const pending = handleRpcRequest(
      envelope,
      extensionSender,
      extensionId,
      extensionPrefix,
      requestResponse
    )
    await vi.waitFor(() => expect(receivedSignal).toBeDefined())

    const cancellationResponse = vi.fn()
    handleRpcCancellation(
      {
        type: RPC_CANCEL_MESSAGE_TYPE,
        version: RPC_PROTOCOL_VERSION,
        requestId: envelope.requestId
      },
      extensionSender,
      extensionId,
      extensionPrefix,
      cancellationResponse
    )
    await pending

    expect(receivedSignal?.aborted).toBe(true)
    expect(cancellationResponse).toHaveBeenCalledWith({
      success: true,
      cancelled: true
    })
    expect(requestResponse.mock.calls[0][0]).toMatchObject({
      ok: false,
      error: { code: RpcErrorCode.Timeout, status: 408 }
    })
    expect(mocks.error).not.toHaveBeenCalled()
  })
})
