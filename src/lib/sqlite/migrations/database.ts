/**
 * The database surface the forward-only migrations are written against.
 *
 * This used to be sql.js's `Database` type, which is why every migration
 * imported a type from an engine that no longer runs in the extension. The
 * shape is unchanged — these are the members the migrations actually call — so
 * the runner keeps working against both engines without a compatibility cast.
 *
 * Two implementations exist, both official sqlite-wasm underneath:
 *   - the OPFS owner worker (src/lib/persistence/chat-db-worker.ts)
 *   - the legacy in-memory blob fallback (src/lib/persistence/legacy-blob-db.ts)
 * Both obtain one through `asMigrationDatabase` below.
 */

import type { Database as SqliteWasmDatabase } from "@sqlite.org/sqlite-wasm"

export type MigrationBindable = string | number | null | Uint8Array

export interface MigrationStatement {
  bind: (bind: MigrationBindable[]) => boolean
  step: () => boolean
  getAsObject: () => Record<string, unknown>
  free: () => boolean
}

export interface MigrationExecResult {
  columns: string[]
  values: unknown[][]
}

export interface MigrationDatabase {
  run: (sql: string, bind?: MigrationBindable[]) => MigrationDatabase
  exec: (sql: string) => MigrationExecResult[]
  prepare: (sql: string) => MigrationStatement
}

/**
 * Adapt an official sqlite-wasm database to the migration surface.
 *
 * `exec` is the one member whose shapes genuinely differ: sqlite-wasm returns
 * rows and column names through separate out-params, while the migrations read
 * sql.js's `[{ columns, values }]`. Everything else is a thin forward.
 */
export const asMigrationDatabase = (
  db: SqliteWasmDatabase
): MigrationDatabase => {
  const adapter: MigrationDatabase = {
    run(sql, bind) {
      db.exec({ sql, ...(bind && bind.length > 0 ? { bind } : {}) })
      return adapter
    },

    exec(sql) {
      const columns: string[] = []
      const values = db.exec({
        sql,
        returnValue: "resultRows",
        rowMode: "array",
        columnNames: columns
      }) as unknown[][]
      if (values.length === 0 && columns.length === 0) return []
      return [{ columns, values }]
    },

    prepare(sql) {
      const stmt = db.prepare(sql)
      return {
        bind(bind) {
          stmt.bind(bind as never)
          return true
        },
        step() {
          return stmt.step()
        },
        getAsObject() {
          const names = stmt.getColumnNames()
          const row: Record<string, unknown> = {}
          names.forEach((name, index) => {
            row[name] = stmt.get(index)
          })
          return row
        },
        free() {
          stmt.finalize()
          return true
        }
      }
    }
  }

  return adapter
}
