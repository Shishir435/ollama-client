import type { AgentArtifactStore } from "@ollama-client/agent-runtime"
import {
  AgentArtifactSchema,
  MAX_AGENT_ARTIFACT_TOTAL_BYTES,
  MAX_AGENT_ARTIFACTS
} from "@ollama-client/contracts"
import { z } from "zod"
import { query, run, runWithMeta, withTransaction } from "@/lib/sqlite/db"

/** Decoding is fail-closed: a damaged artifact cannot reach a page or model. */
const storedMetadata = (metadata: unknown) => {
  if (typeof metadata !== "string")
    throw new Error("Unreadable artifact metadata")
  return AgentArtifactSchema.parse(JSON.parse(metadata))
}

/** One owner database; upload claims survive worker loss and artifact expiration. */
export const createAgentArtifactStore = (): AgentArtifactStore => ({
  async list(runId) {
    const rows = await query(
      "SELECT metadata FROM agent_artifacts WHERE runId = ?",
      [runId]
    )
    return rows.map((row) => storedMetadata(row.metadata))
  },
  async get(runId, artifactId) {
    const rows = await query(
      "SELECT metadata, bytes FROM agent_artifacts WHERE runId = ? AND id = ?",
      [runId, artifactId]
    )
    const row = rows[0]
    if (!row) return undefined
    if (!(row.bytes instanceof Uint8Array))
      throw new Error("Unreadable artifact bytes")
    return { artifact: storedMetadata(row.metadata), bytes: row.bytes }
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
      const count = z.number().int().nonnegative().parse(rows[0]?.count)
      if (count >= Math.min(maxArtifacts, MAX_AGENT_ARTIFACTS))
        throw new Error("Artifact count limit reached")
      const totals = await tx.query(
        "SELECT COALESCE(SUM(length(bytes)), 0) AS size FROM agent_artifacts"
      )
      const totalBytes = z.number().int().nonnegative().parse(totals[0]?.size)
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
