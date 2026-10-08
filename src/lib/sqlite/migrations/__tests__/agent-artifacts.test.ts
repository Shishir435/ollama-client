import { createRequire } from "node:module"
import initSqlJs from "sql.js/dist/sql-wasm.js"
import { beforeAll, describe, expect, it } from "vitest"
import { ensureAgentArtifacts } from "../add-agent-artifacts"

const require = createRequire(import.meta.url)
let SQL: Awaited<ReturnType<typeof initSqlJs>>
beforeAll(async () => {
  SQL = await initSqlJs({
    locateFile: () => require.resolve("sql.js/dist/sql-wasm.wasm")
  })
})
const database = () => {
  const db = new SQL.Database()
  db.run("PRAGMA foreign_keys = ON")
  db.run("CREATE TABLE agent_runs (id TEXT PRIMARY KEY)")
  db.run("INSERT INTO agent_runs VALUES ('run')")
  ensureAgentArtifacts(db)
  return db
}

describe("artifact storage migration", () => {
  it("is idempotent and keeps blob bytes and upload ownership across database reload", () => {
    const db = database()
    db.run("INSERT INTO agent_artifacts VALUES (?, ?, ?, ?, ?)", [
      "file",
      "run",
      "metadata",
      new Uint8Array([0, 42, 255]),
      5000
    ])
    db.run("INSERT INTO agent_artifact_uploads VALUES (?, ?, ?, ?, ?)", [
      "upload",
      "run",
      "file",
      "exact intent",
      "claimed"
    ])
    ensureAgentArtifacts(db)
    const reloaded = new SQL.Database(db.export())
    ensureAgentArtifacts(reloaded)
    expect(
      reloaded.exec("SELECT bytes FROM agent_artifacts")[0].values[0][0]
    ).toEqual(new Uint8Array([0, 42, 255]))
    expect(
      reloaded.exec("SELECT intent, status FROM agent_artifact_uploads")[0]
        .values
    ).toEqual([["exact intent", "claimed"]])
    reloaded.close()
    db.close()
  })
  it("prunes content without forgetting uncertain upload intent, and run deletion removes both", () => {
    const db = database()
    db.run(
      "INSERT INTO agent_artifacts VALUES ('file', 'run', 'metadata', X'2A', 100)"
    )
    db.run(
      "INSERT INTO agent_artifact_uploads VALUES ('upload', 'run', 'file', 'intent', 'uncertain')"
    )
    db.run("DELETE FROM agent_artifacts WHERE expiresAt <= 100")
    expect(db.exec("SELECT COUNT(*) FROM agent_artifacts")[0].values).toEqual([
      [0]
    ])
    expect(
      db.exec("SELECT status FROM agent_artifact_uploads")[0].values
    ).toEqual([["uncertain"]])
    db.run("DELETE FROM agent_runs WHERE id = 'run'")
    expect(
      db.exec("SELECT COUNT(*) FROM agent_artifact_uploads")[0].values
    ).toEqual([[0]])
    db.close()
  })
  it("prevents duplicate upload owners and artifacts without a run", () => {
    const db = database()
    db.run(
      "INSERT INTO agent_artifact_uploads VALUES ('upload', 'run', 'file', 'intent', 'claimed')"
    )
    expect(() =>
      db.run(
        "INSERT INTO agent_artifact_uploads VALUES ('upload', 'run', 'file', 'other', 'completed')"
      )
    ).toThrow()
    expect(() =>
      db.run(
        "INSERT INTO agent_artifacts VALUES ('file', 'missing', 'metadata', X'2A', 100)"
      )
    ).toThrow()
    expect(() =>
      db.run("UPDATE agent_artifact_uploads SET status = 'retry'")
    ).toThrow()
    db.close()
  })
})
