import { describe, expect, it } from "vitest"
import { IngestionJobResultSchema } from "../ingestion-rpc"
import {
  ModelPullJobResultSchema,
  ModelPullListActiveRequestSchema
} from "../model-pull-rpc"

const jobId = "123e4567-e89b-12d3-a456-426614174000"

describe("durable job RPC contracts", () => {
  it("validates recoverable ingestion snapshots", () => {
    const result = {
      jobId,
      fileId: "file-1",
      status: "running",
      phase: "embedding"
    } as const

    expect(IngestionJobResultSchema.parse(result)).toEqual(result)
    expect(
      IngestionJobResultSchema.safeParse({ ...result, phase: "unknown" })
        .success
    ).toBe(false)
  })

  it("bounds model-pull progress and sanitizes failures", () => {
    const result = {
      jobId,
      model: "llama3",
      status: "failed",
      progress: 100,
      failure: { status: 503, message: "Provider unavailable" }
    } as const

    expect(ModelPullJobResultSchema.parse(result)).toEqual(result)
    expect(
      ModelPullJobResultSchema.safeParse({ ...result, progress: 101 }).success
    ).toBe(false)
    expect(
      ModelPullListActiveRequestSchema.safeParse({ extra: true }).success
    ).toBe(false)
  })
})
