import type { MigrationDatabase } from "./database"

/**
 * Per-model preferences — parameter presets, capability overrides, tool
 * overrides — one row per kind and provider-qualified model key. Each lived
 * as one JSON map in storage.sync, which grows with every model a user
 * touches and is refused past the 8 KB per-item quota.
 */
export const MODEL_PREFERENCES_SQL = `
CREATE TABLE IF NOT EXISTS model_preferences (
  kind TEXT NOT NULL,
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  updatedAt INTEGER NOT NULL,
  PRIMARY KEY (kind, key)
);
`

export const ensureModelPreferencesTable = (db: MigrationDatabase): void => {
  db.run(MODEL_PREFERENCES_SQL)
}
