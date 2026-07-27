import type { Database } from "sql.js"

/** Move prompt-template persistence out of storage.sync-sized JSON arrays. */
export const ensurePromptTemplatesTable = (db: Database): void => {
  db.run(`
    CREATE TABLE IF NOT EXISTS prompt_templates (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT,
      category TEXT,
      systemPrompt TEXT,
      userPrompt TEXT NOT NULL,
      tags TEXT,
      createdAt INTEGER NOT NULL,
      usageCount INTEGER NOT NULL DEFAULT 0,
      sortOrder INTEGER NOT NULL
    )
  `)
  db.run(
    "CREATE INDEX IF NOT EXISTS idx_prompt_templates_sortOrder ON prompt_templates(sortOrder)"
  )
}
