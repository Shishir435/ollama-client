import type { AgentArtifactStore } from "@ollama-client/agent-runtime"
import {
  AgentArtifactSchema,
  MAX_AGENT_ARTIFACT_TOTAL_BYTES,
  MAX_AGENT_ARTIFACTS
} from "@ollama-client/contracts"
import { z } from "zod"
import {
  flushSave,
  query,
  run,
  runWithMeta,
  withTransaction
} from "@/lib/sqlite/db"
import { decodeRow } from "./row-decoder"

/** Parse JSON inside the row schema so corrupt content never escapes in errors. */
const metadataSchema = z.preprocess((value) => {
  if (typeof value !== "string") return undefined
  try {
    return JSON.parse(value)
  } catch {
    return undefined
  }
}, AgentArtifactSchema)
const ArtifactMetadataRowSchema = z
  .object({
    id: z.string().uuid(),
    metadata: metadataSchema
  })
  .refine((row) => row.id === row.metadata.id)
const ArtifactRowSchema = ArtifactMetadataRowSchema.safeExtend({
  bytes: z.instanceof(Uint8Array)
})
const CountRowSchema = z.object({ count: z.number().int().nonnegative() })
const SizeRowSchema = z.object({ size: z.number().int().nonnegative() })

/** Refuse corrupt rows instead of silently dropping artifacts from run bounds. */
const requireRow = <T>(
  schema: z.ZodType<T>,
  row: unknown,
  operation: string
): T => {
  const decoded = decodeRow(schema, row, {
    table: "agent_artifacts",
    operation
  })
  if (!decoded) throw new Error("Unreadable artifact row")
  return decoded
}

/** One owner database; upload claims survive worker loss and artifact expiration. */
export const createAgentArtifactStore = (): AgentArtifactStore => ({
  async list(runId) {
    const rows = await query(
      "SELECT id, metadata FROM agent_artifacts WHERE runId = ?",
      [runId]
    )
    return rows.map(
      (row) => requireRow(ArtifactMetadataRowSchema, row, "list").metadata
    )
  },
  async get(runId, artifactId) {
    const rows = await query(
      "SELECT id, metadata, bytes FROM agent_artifacts WHERE runId = ? AND id = ?",
      [runId, artifactId]
    )
    const row = rows[0]
    if (!row) return undefined
    const decoded = requireRow(ArtifactRowSchema, row, "get")
    return { artifact: decoded.metadata, bytes: decoded.bytes }
  },
  async put(artifact, bytes, maxArtifacts) {
    const valid = AgentArtifactSchema.parse(artifact)
    if (bytes.byteLength !== valid.size)
      throw new Error("Artifact size mismatch")
    await withTransaction(async (tx) => {
      const rows = await tx.query(
        "SELECT COUNT(*) AS count FROM agent_artifacts WHERE runId = ?",
        [valid.runId]
      )
      const count = requireRow(CountRowSchema, rows[0], "count").count
      if (count >= Math.min(maxArtifacts, MAX_AGENT_ARTIFACTS))
        throw new Error("Artifact count limit reached")
      const totals = await tx.query(
        "SELECT COALESCE(SUM(length(bytes)), 0) AS size FROM agent_artifacts"
      )
      const totalBytes = requireRow(SizeRowSchema, totals[0], "size").size
      if (totalBytes + bytes.byteLength > MAX_AGENT_ARTIFACT_TOTAL_BYTES)
        throw new Error("Artifact storage byte limit reached")
      await tx.run(
        "INSERT INTO agent_artifacts (id, runId, metadata, bytes, expiresAt) VALUES (?, ?, ?, ?, ?)",
        [valid.id, valid.runId, JSON.stringify(valid), bytes, valid.expiresAt]
      )
    })
  },
  async prune(now) {
    await run("DELETE FROM agent_artifacts WHERE expiresAt <= ?", [now])
  },
  async claimUpload(upload) {
    let claimed = false
    await withTransaction(async (tx) => {
      const result = await tx.runWithMeta(
        "INSERT OR IGNORE INTO agent_artifact_uploads (id, runId, artifactId, intent, status) VALUES (?, ?, ?, ?, 'claimed')",
        [upload.id, upload.runId, upload.artifactId, JSON.stringify(upload)]
      )
      claimed = result.changes === 1
    })
    // Legacy transactions commit in memory; dispatch must wait for the saved image.
    if (claimed) await flushSave()
    return claimed
  },
  async settleUpload(id, status) {
    const result = await runWithMeta(
      "UPDATE agent_artifact_uploads SET status = ? WHERE id = ? AND status = 'claimed'",
      [status, id]
    )
    if (result.changes !== 1)
      throw new Error("Artifact upload claim could not be settled")
  }
})
