import type { MigrationDatabase } from "./database"

/** Store the immutable conversation prefix once per live tool loop. */
export const ensureToolLoopBaseMessages = (db: MigrationDatabase): number => {
  const statement = db.prepare("PRAGMA table_info(tool_loop_runs)")
  let exists = false
  while (statement.step()) {
    if (statement.getAsObject().name === "baseMessages") exists = true
  }
  statement.free()
  if (exists) return 0
  db.run("ALTER TABLE tool_loop_runs ADD COLUMN baseMessages TEXT")
  return 1
}
