import { describe, expect, it } from "vitest"
import { AppFailureSchema } from "../app-failure"
import { ChatMessageSchema } from "../chat"
import { DurableContextOptionsSchema } from "../context"
import {
  createRpcResponseEnvelopeSchema,
  RPC_PROTOCOL_VERSION,
  RPC_REQUEST_MESSAGE_TYPE,
  RPC_RESPONSE_MESSAGE_TYPE,
  RpcErrorCode,
  RpcMethod,
  RpcRequestEnvelopeSchema
} from "../rpc"
import {
  CHAT_STREAM_EVENT_TYPES,
  MODEL_PULL_EVENT_TYPES,
  STREAM_PROTOCOL_VERSION
} from "../streams"
import { PersistedTurnRequestSchema } from "../turns"

describe("contracts package", () => {
  it("runs without application or browser test shims", () => {
    expect("chrome" in globalThis).toBe(false)
    expect("indexedDB" in globalThis).toBe(false)
    expect("document" in globalThis).toBe(false)
  })

  it("validates strict RPC envelopes without extension globals", () => {
    const requestId = "11111111-1111-4111-8111-111111111111"
    expect(
      RpcRequestEnvelopeSchema.parse({
        type: RPC_REQUEST_MESSAGE_TYPE,
        version: RPC_PROTOCOL_VERSION,
        requestId,
        method: RpcMethod.ProvidersList,
        request: {}
      })
    ).toMatchObject({ requestId, method: RpcMethod.ProvidersList })

    const responseSchema = createRpcResponseEnvelopeSchema(AppFailureSchema)
    expect(
      responseSchema.parse({
        type: RPC_RESPONSE_MESSAGE_TYPE,
        version: RPC_PROTOCOL_VERSION,
        requestId,
        ok: false,
        error: {
          code: RpcErrorCode.Internal,
          status: 500,
          fallbackMessage: "failed",
          supportCode: "OLC-TEST"
        }
      }).ok
    ).toBe(false)
  })

  it("exports stable stream identifiers", () => {
    expect(STREAM_PROTOCOL_VERSION).toBe(1)
    expect(CHAT_STREAM_EVENT_TYPES.CHUNK).toBe("chat_chunk")
    expect(MODEL_PULL_EVENT_TYPES.COMPLETE).toBe("model_pull_complete")
  })

  it("validates persisted turn and context contracts in clean Node", () => {
    const context = {
      rawInput: "hello",
      messages: [{ role: "user", content: "hello" }],
      hasTabContext: false,
      contextText: "",
      tabDocuments: [],
      memoryEnabled: false,
      maxTabContextChars: 10_000,
      maxRagContextChars: 10_000,
      groundedOnlyMode: false,
      selectedModel: "llama3",
      selectedModelRef: { providerId: "ollama", modelId: "llama3" }
    }

    expect(DurableContextOptionsSchema.parse(context)).toMatchObject(context)
    expect(
      PersistedTurnRequestSchema.parse({
        version: 1,
        context,
        userMessage: { role: "user", content: "hello" }
      })
    ).toMatchObject({ version: 1, context })
  })

  it("measures replay limits as UTF-8 without browser globals", () => {
    const oversized = ChatMessageSchema.safeParse({
      role: "assistant",
      content: "response",
      replayArtifact: {
        version: 1,
        wire: "openai",
        providerId: "openrouter",
        model: "remote-model",
        blocks: [
          {
            type: "reasoning.encrypted",
            data: "😀".repeat(270_000)
          }
        ]
      }
    })

    expect(oversized.success).toBe(false)
  })
})
