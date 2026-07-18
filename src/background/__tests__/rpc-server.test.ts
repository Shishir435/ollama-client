import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  testConnection: vi.fn(),
  listModels: vi.fn(),
  info: vi.fn(),
  error: vi.fn()
}))

vi.mock("@/lib/providers/provider-rpc-service", () => ({
  ProviderRpcService: {
    list: mocks.list,
    testConnection: mocks.testConnection,
    listModels: mocks.listModels
  }
}))

vi.mock("@/lib/logger", () => ({
  logger: {
    info: mocks.info,
    error: mocks.error
  }
}))

import { handleRpcRequest } from "@/background/rpc-server"
import { createAppError } from "@/lib/error-utils"
import {
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
  mocks.list.mockResolvedValue({ providers: [] })
  mocks.testConnection.mockResolvedValue({
    providerId: "ollama",
    reachable: true,
    modelCount: 1,
    latencyMs: 4
  })
  mocks.listModels.mockResolvedValue({ models: [], failures: [] })
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

  it("normalizes provider model extensions to the public wire shape", async () => {
    mocks.listModels.mockResolvedValue({
      models: [
        {
          name: "future-model",
          model: "future-model",
          modified_at: "2026-07-18T00:00:00.000Z",
          size: 1,
          digest: "digest",
          futureField: "provider-owned",
          details: {
            parent_model: "",
            format: "gguf",
            family: "future",
            families: [],
            parameter_size: "",
            quantization_level: "",
            futureDetail: true
          }
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
    expect(result.models[0]).not.toHaveProperty("futureField")
    expect(result.models[0].details).not.toHaveProperty("futureDetail")
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
})
