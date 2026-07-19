import type { Database as SqliteWasmDatabase } from "@sqlite.org/sqlite-wasm"
import type { Database as SqlJsDatabase } from "sql.js"

// Minimal sql.js-Database facade over an official sqlite-wasm database.
// Exists so the forward-only migration runner (src/lib/sqlite/migrations/),
// written against sql.js, runs unchanged inside the OPFS owner worker. Only
// the members the migrations actually use are implemented: run, exec,
// prepare().bind/step/getAsObject/free.

type SqlBindable = string | number | null | Uint8Array

export const asSqlJsDatabase = (db: SqliteWasmDatabase): SqlJsDatabase => {
  const compat = {
    run(sql: string, bind?: SqlBindable[]) {
      db.exec({ sql, ...(bind && bind.length > 0 ? { bind } : {}) })
      return compat
    },

    exec(sql: string) {
      const columnNames: string[] = []
      const values = db.exec({
        sql,
        returnValue: "resultRows",
        rowMode: "array",
        columnNames
      }) as unknown[][]
      if (values.length === 0 && columnNames.length === 0) return []
      return [{ columns: columnNames, values }]
    },

    prepare(sql: string) {
      const stmt = db.prepare(sql)
      return {
        bind(bind: SqlBindable[]) {
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

  // The migration runner only touches the subset above; the cast keeps its
  // sql.js signature intact without depending on sql.js at runtime.
  return compat as unknown as SqlJsDatabase
}
