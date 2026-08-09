import { describe, expect, it } from "vitest"
import { AppFailureSchema } from "./app-failure"
import {
  createRpcResponseEnvelopeSchema,
  RPC_PROTOCOL_VERSION,
  RPC_REQUEST_MESSAGE_TYPE,
  RPC_RESPONSE_MESSAGE_TYPE,
  RpcErrorCode,
  RpcMethod,
  RpcRequestEnvelopeSchema
} from "./rpc"
import {
  CHAT_STREAM_EVENT_TYPES,
  MODEL_PULL_EVENT_TYPES,
  STREAM_PROTOCOL_VERSION
} from "./streams"

describe("contracts package", () => {
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
})
