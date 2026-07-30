import { z } from "zod"
import { AppFailureSchema } from "@/protocol/app-failure"
import { MODEL_PULL_EVENT_TYPES } from "./event-types"
import { STREAM_PROTOCOL_VERSION } from "./version"

const version = z.literal(STREAM_PROTOCOL_VERSION)

export const ModelPullClientEventSchema = z.discriminatedUnion("type", [
  z.object({
    version,
    type: z.literal(MODEL_PULL_EVENT_TYPES.START),
    payload: z.object({
      model: z.string().min(1),
      providerId: z.string().optional()
    })
  }),
  z.object({
    version,
    type: z.literal(MODEL_PULL_EVENT_TYPES.CANCEL),
    payload: z.object({ model: z.string().min(1) })
  })
])

export const ModelPullServerEventSchema = z.discriminatedUnion("type", [
  z.object({
    version,
    type: z.literal(MODEL_PULL_EVENT_TYPES.PROGRESS),
    status: z.string(),
    progress: z.number().optional()
  }),
  z.object({
    version,
    type: z.literal(MODEL_PULL_EVENT_TYPES.COMPLETE),
    status: z.string().optional()
  }),
  z.object({
    version,
    type: z.literal(MODEL_PULL_EVENT_TYPES.ERROR),
    failure: AppFailureSchema
  })
])

export type ModelPullClientEvent = z.infer<typeof ModelPullClientEventSchema>
export type ModelPullServerEvent = z.infer<typeof ModelPullServerEventSchema>

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value)

const legacyModelName = (payload: unknown): string => {
  if (typeof payload === "string") return payload
  if (isRecord(payload) && typeof payload.model === "string") {
    return payload.model
  }
  return ""
}

const normalizeLegacyModelPullClientEvent = (
  value: Record<string, unknown>
): Record<string, unknown> => {
  if (value.type !== undefined) return value

  if (value.cancel) {
    return {
      version: STREAM_PROTOCOL_VERSION,
      type: MODEL_PULL_EVENT_TYPES.CANCEL,
      payload: { model: legacyModelName(value.payload) }
    }
  }

  return {
    version: STREAM_PROTOCOL_VERSION,
    type: MODEL_PULL_EVENT_TYPES.START,
    payload:
      typeof value.payload === "string"
        ? { model: value.payload }
        : value.payload
  }
}

export const parseModelPullClientEvent = (value: unknown) => {
  if (!isRecord(value)) return ModelPullClientEventSchema.safeParse(value)
  const normalized = normalizeLegacyModelPullClientEvent(value)
  return ModelPullClientEventSchema.safeParse({
    ...normalized,
    version:
      isRecord(normalized) && normalized.version !== undefined
        ? normalized.version
        : STREAM_PROTOCOL_VERSION
  })
}

export const parseModelPullServerEvent = (value: unknown) => {
  if (!isRecord(value)) return ModelPullServerEventSchema.safeParse(value)
  const version = value.version ?? STREAM_PROTOCOL_VERSION
  if (typeof value.type === "string") {
    return ModelPullServerEventSchema.safeParse({ ...value, version })
  }
  if (value.error !== undefined) {
    const failure =
      typeof value.error === "string"
        ? { status: 0, message: value.error }
        : value.error
    return ModelPullServerEventSchema.safeParse({
      version,
      type: MODEL_PULL_EVENT_TYPES.ERROR,
      failure
    })
  }
  if (value.done === true) {
    return ModelPullServerEventSchema.safeParse({
      version,
      type: MODEL_PULL_EVENT_TYPES.COMPLETE,
      ...(typeof value.status === "string" ? { status: value.status } : {})
    })
  }
  return ModelPullServerEventSchema.safeParse({
    ...value,
    version,
    type: MODEL_PULL_EVENT_TYPES.PROGRESS
  })
}
