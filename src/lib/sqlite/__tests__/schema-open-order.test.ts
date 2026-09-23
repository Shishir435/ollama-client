import { createRequire } from "node:module"
import initSqlJs from "sql.js/dist/sql-wasm.js"
import { beforeAll, describe, expect, it } from "vitest"

import {
  repairSchemaDrift,
  runMigrations,
  setSchemaVersion
} from "../migrations/migration-runner"
import { SCHEMA_SQL } from "../schema"

const require = createRequire(import.meta.url)
const wasmPath = require.resolve("sql.js/dist/sql-wasm.wasm")

let SQL: Awaited<ReturnType<typeof initSqlJs>>

beforeAll(async () => {
  SQL = await initSqlJs({ locateFile: () => wasmPath })
})

type Db = InstanceType<typeof SQL.Database>

const names = (db: Db, sql: string): string[] =>
  (db.exec(sql)[0]?.values ?? []).map((row) => String(row[0]))

/** A profile last opened before migration 18: no chat-linkage columns. */
const profileBeforeLinkage = (): Db => {
  const db = new SQL.Database()
  db.exec(SCHEMA_SQL)
  db.exec(`
    DROP INDEX IF EXISTS idx_messages_agent_run;
    DROP INDEX IF EXISTS idx_agent_runs_session;
    ALTER TABLE messages DROP COLUMN agentRunId;
    ALTER TABLE messages DROP COLUMN agentHandoff;
    ALTER TABLE agent_runs DROP COLUMN sessionId;
    ALTER TABLE agent_runs DROP COLUMN requestMessageId;
    ALTER TABLE agent_runs DROP COLUMN resultMessageId;
    ALTER TABLE agent_runs DROP COLUMN parentRunId;
    INSERT INTO sessions (id, title, createdAt, updatedAt)
      VALUES ('kept', 'Kept', 1, 1);
  `)
  setSchemaVersion(db as never, 17)
  return db
}

/**
 * The order the OPFS owner opens a database in: the schema script on every
 * open, then the migrations. The script therefore meets every older shape a
 * profile can be in, and a statement in it that names a column a migration
 * adds fails before that migration can run — which is how two linkage indexes
 * kept every upgraded Chromium profile from opening at all.
 */
const openLikeTheOwner = (db: Db): void => {
  db.exec(SCHEMA_SQL)
  runMigrations(db as never)
  repairSchemaDrift(db as never)
}

describe("opening a database the way the owner does", () => {
  it("runs the schema script cleanly on a profile from before the linkage", () => {
    const db = profileBeforeLinkage()

    expect(() => openLikeTheOwner(db)).not.toThrow()

    expect(names(db, "SELECT id FROM sessions")).toEqual(["kept"])
    expect(names(db, "SELECT name FROM pragma_table_info('messages')")).toEqual(
      expect.arrayContaining(["agentRunId", "agentHandoff"])
    )
    expect(
      names(
        db,
        `SELECT name FROM sqlite_master WHERE type = 'index'
           AND name IN ('idx_messages_agent_run', 'idx_agent_runs_session')
         ORDER BY name`
      )
    ).toEqual(["idx_agent_runs_session", "idx_messages_agent_run"])
    db.close()
  })

  it("gives a database created fresh the same indexes", () => {
    const db = new SQL.Database()

    openLikeTheOwner(db)

    expect(
      names(
        db,
        `SELECT name FROM sqlite_master WHERE type = 'index'
           AND name IN ('idx_messages_agent_run', 'idx_agent_runs_session')
         ORDER BY name`
      )
    ).toEqual(["idx_agent_runs_session", "idx_messages_agent_run"])
    db.close()
  })
})
