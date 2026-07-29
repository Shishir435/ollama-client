import { z } from "zod"
import { AppFailureSchema } from "@/protocol/app-failure"
import { STREAM_PROTOCOL_VERSION } from "./version"

const version = z.literal(STREAM_PROTOCOL_VERSION)

export const ModelPullClientEventSchema = z.discriminatedUnion("type", [
  z.object({
    version,
    type: z.literal("model_pull_start"),
    payload: z.object({
      model: z.string().min(1),
      providerId: z.string().optional()
    })
  }),
  z.object({
    version,
    type: z.literal("model_pull_cancel"),
    payload: z.object({ model: z.string().min(1) })
  })
])

export const ModelPullServerEventSchema = z.discriminatedUnion("type", [
  z.object({
    version,
    type: z.literal("model_pull_progress"),
    status: z.string(),
    progress: z.number().optional()
  }),
  z.object({
    version,
    type: z.literal("model_pull_complete"),
    status: z.string().optional()
  }),
  z.object({
    version,
    type: z.literal("model_pull_error"),
    failure: AppFailureSchema
  })
])

export type ModelPullClientEvent = z.infer<typeof ModelPullClientEventSchema>
export type ModelPullServerEvent = z.infer<typeof ModelPullServerEventSchema>

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value)

export const parseModelPullClientEvent = (value: unknown) => {
  if (!isRecord(value)) return ModelPullClientEventSchema.safeParse(value)
  const payload = value.payload
  const normalized =
    value.type !== undefined
      ? value
      : value.cancel
        ? {
            version: STREAM_PROTOCOL_VERSION,
            type: "model_pull_cancel",
            payload: {
              model:
                typeof payload === "string"
                  ? payload
                  : isRecord(payload) && typeof payload.model === "string"
                    ? payload.model
                    : ""
            }
          }
        : {
            version: STREAM_PROTOCOL_VERSION,
            type: "model_pull_start",
            payload: typeof payload === "string" ? { model: payload } : payload
          }
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
      type: "model_pull_error",
      failure
    })
  }
  if (value.done === true) {
    return ModelPullServerEventSchema.safeParse({
      version,
      type: "model_pull_complete",
      ...(typeof value.status === "string" ? { status: value.status } : {})
    })
  }
  return ModelPullServerEventSchema.safeParse({
    ...value,
    version,
    type: "model_pull_progress"
  })
}
