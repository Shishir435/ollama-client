import { TERMINAL_TURN_STATUSES } from "@ollama-client/contracts/turns"
import type { MigrationDatabase } from "./database"

const TERMINAL_STATUS_LIST = TERMINAL_TURN_STATUSES.map(
  (status) => `'${status}'`
).join(", ")

/**
 * Drop the resumable input from turns that already ended.
 *
 * Every row written before this migration kept the full conversation, file
 * text and page bodies that produced it, forever. New terminal writes compact
 * themselves; this clears the backlog those writes never touch, since a
 * settled row is never updated again.
 *
 * `compactedAt` is taken from each row's own `updatedAt` rather than the clock,
 * so the marker dates the turn instead of the upgrade. The JSON is assembled
 * with string concatenation because it must produce identical bytes on both
 * backends without depending on the JSON1 extension being compiled in.
 */
export const compactTerminalTurnRequests = (db: MigrationDatabase): void => {
  db.run(`
    UPDATE turn_runs
       SET request = '{"version":1,"compacted":true,"compactedAt":' || updatedAt || '}'
     WHERE status IN (${TERMINAL_STATUS_LIST})
  `)
}
