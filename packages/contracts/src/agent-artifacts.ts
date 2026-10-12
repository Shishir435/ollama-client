import { z } from "zod"

/** Limits apply to bytes, not file-name or MIME claims supplied by a page. */
export const MAX_AGENT_ARTIFACT_BYTES = 5 * 1024 * 1024
export const MAX_AGENT_ARTIFACTS = 8
export const MAX_AGENT_ARTIFACT_TOTAL_BYTES = 50 * 1024 * 1024
export const MAX_AGENT_ARTIFACT_TEXT_CHARS = 20_000
export const AGENT_ARTIFACT_RETENTION_MS = 24 * 60 * 60 * 1000

export const AGENT_ARTIFACT_MIME_TYPES = [
  "text/plain",
  "text/markdown",
  "text/csv",
  "application/json",
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
] as const

/** An opaque, run-owned identity; never a local path or a browser filename. */
export const AgentArtifactSchema = z
  .object({
    id: z.string().uuid(),
    runId: z.string().min(1).max(200),
    name: z
      .string()
      .min(1)
      .max(200)
      .refine(
        (name) =>
          !/[\\/]/.test(name) &&
          [...name].every((char) => char.charCodeAt(0) >= 32)
      ),
    mime: z.enum(AGENT_ARTIFACT_MIME_TYPES),
    size: z.number().int().nonnegative().max(MAX_AGENT_ARTIFACT_BYTES),
    sha256: z.string().regex(/^[0-9a-f]{64}$/),
    provenance: z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("user_selected") }).strict(),
      z
        .object({
          kind: z.literal("generated"),
          stepId: z.string().min(1).max(200)
        })
        .strict(),
      z
        .object({
          kind: z.literal("download"),
          downloadId: z.number().int().nonnegative(),
          sourceUrl: z.url().max(2048)
        })
        .strict()
    ]),
    createdAt: z.number().int().nonnegative(),
    expiresAt: z.number().int().nonnegative()
  })
  .strict()
  .refine(
    (artifact) =>
      artifact.expiresAt > artifact.createdAt &&
      artifact.expiresAt - artifact.createdAt <= AGENT_ARTIFACT_RETENTION_MS
  )
export type AgentArtifact = z.infer<typeof AgentArtifactSchema>

/** Completion is a browser transfer state, never inferred from a click. */
export const AgentDownloadStateSchema = z.enum([
  "initiated",
  "completed",
  "failed",
  "canceled"
])
export type AgentDownloadState = z.infer<typeof AgentDownloadStateSchema>
