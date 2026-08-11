import type { MigrationDatabase } from "./database"

const LEGACY_BUILDING_CONTEXT_STATUS = "building-context"

/**
 * Rename the hyphenated `building-context` turn status to `building_context`.
 *
 * Every other durable enum value in the schema is a single word; this one was
 * the outlier, and the only key in the turn transition table that had to be
 * quoted. The value is persisted, so uniformity costs a migration: `0.13.0`
 * prerelease profiles hold live rows written with the old spelling, and both
 * recovery and the session-activity query match on the exact string.
 */
export const renameBuildingContextStatus = (db: MigrationDatabase): void => {
  db.run("UPDATE turn_runs SET status = 'building_context' WHERE status = ?", [
    LEGACY_BUILDING_CONTEXT_STATUS
  ])
}
