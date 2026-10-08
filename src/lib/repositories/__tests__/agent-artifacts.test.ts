import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import type { AgentArtifact } from "@ollama-client/contracts"
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi
} from "vitest"
import { logger } from "@/lib/logger"
import {
  type ChatDbEngine,
  createChatDbEngine
} from "@/lib/persistence/chat-db-engine"
import { deleteLegacyBlob } from "@/lib/persistence/legacy-blob-db"
import { flushSave, run } from "@/lib/sqlite/db"
import { createAgentArtifactStore } from "../agent-artifacts"

const require = createRequire(import.meta.url)
let wasmBinary: ArrayBuffer
const engines: ChatDbEngine[] = []
beforeAll(() => {
  const bytes = readFileSync(
    require.resolve("@sqlite.org/sqlite-wasm/sqlite3.wasm")
  )
  wasmBinary = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength
  )
})
const boot = async () => {
  const engine = createChatDbEngine({
    wasmBinary: Promise.resolve(wasmBinary),
    onError: () => {}
  })
  engines.push(engine)
  await engine.submit({ op: "setBackend", backend: "legacy" })
  globalThis.__persistenceHostCall = (request) => engine.submit(request)
  return engine
}
const artifact: AgentArtifact = {
  id: "00000000-0000-4000-8000-000000000001",
  runId: "run",
  name: "report.txt",
  mime: "text/plain",
  size: 1,
  sha256: "a".repeat(64),
  provenance: { kind: "user_selected" },
  createdAt: 1,
  expiresAt: 1000
}
const upload = {
  id: "upload",
  runId: artifact.runId,
  artifactId: artifact.id,
  sha256: artifact.sha256,
  destination: "https://example.com/upload",
  stepId: "step",
  status: "claimed" as const
}
beforeEach(async () => {
  await deleteLegacyBlob()
  await boot()
  await run(
    "INSERT INTO agent_runs (id, status, checkpoint, createdAt, updatedAt) VALUES ('run', 'running', '{}', 1, 1)"
  )
  await createAgentArtifactStore().put(artifact, new Uint8Array([42]), 8)
  await flushSave()
})
afterEach(async () => {
  delete globalThis.__persistenceHostCall
  await Promise.all(
    engines.splice(0).map((engine) => engine.submit({ op: "flush" }))
  )
  vi.restoreAllMocks()
})
describe("artifact repository on the legacy owner", () => {
  it("saves a claim before returning, so an immediate restart cannot replay it", async () => {
    const store = createAgentArtifactStore()
    expect(await store.claimUpload(upload)).toBe(true)
    // No debounce wait or caller flush: the new owner reads only the saved image.
    await boot()
    const restarted = createAgentArtifactStore()
    expect(await restarted.get(artifact.runId, artifact.id)).toEqual({
      artifact,
      bytes: new Uint8Array([42])
    })
    expect(await restarted.claimUpload(upload)).toBe(false)
  })
  it("refuses dispatch permission when saving the claim fails", async () => {
    const host = globalThis.__persistenceHostCall
    if (!host) throw new Error("Missing test owner")
    globalThis.__persistenceHostCall = (request) =>
      request.op === "flush"
        ? Promise.reject(new Error("save failed"))
        : host(request)
    await expect(
      createAgentArtifactStore().claimUpload(upload)
    ).rejects.toThrow()
  })
  it.each([
    "invalid JSON private content",
    JSON.stringify({ ...artifact, name: "private/content" })
  ])("refuses damaged metadata and logs only decoder paths and codes (%#)", async (metadata) => {
    const warn = vi.spyOn(logger, "warn").mockImplementation(() => {})
    await run("UPDATE agent_artifacts SET metadata = ? WHERE id = ?", [
      metadata,
      artifact.id
    ])
    const store = createAgentArtifactStore()
    await expect(store.get(artifact.runId, artifact.id)).rejects.toThrow(
      "Unreadable artifact row"
    )
    await expect(store.list(artifact.runId)).rejects.toThrow(
      "Unreadable artifact row"
    )
    expect(warn).toHaveBeenCalledWith(
      "Refused an unreadable durable row",
      "RowDecoder",
      expect.objectContaining({
        table: "agent_artifacts",
        rowId: artifact.id,
        issues: expect.any(Array)
      })
    )
    expect(JSON.stringify(warn.mock.calls)).not.toContain("private")
  })
  it("refuses damaged blob bytes", async () => {
    await run(
      "UPDATE agent_artifacts SET bytes = 'private bytes' WHERE id = ?",
      [artifact.id]
    )
    await expect(
      createAgentArtifactStore().get(artifact.runId, artifact.id)
    ).rejects.toThrow("Unreadable artifact row")
  })
})
