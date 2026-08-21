/**
 * Backend registry.
 *
 * Adding a runtime means writing an `AgentBackend` and listing it here; nothing in
 * `src/core/` changes. The name is what `--backend` and `OLC_BACKEND` select.
 */

import { createCodexBackend } from "./codex/index.js"
import { createOpencodeBackend } from "./opencode/index.js"
import type { BackendContext, BackendFactory } from "./types.js"

const BACKENDS: Record<string, BackendFactory> = {
  codex: createCodexBackend,
  opencode: createOpencodeBackend
}

export const backendNames = (): string[] => Object.keys(BACKENDS).sort()

export const createBackend = (name: string, context: BackendContext) => {
  const factory = BACKENDS[name]
  if (!factory) {
    throw new Error(
      `Unknown backend '${name}'. Available: ${backendNames().join(", ")}`
    )
  }
  return factory(context)
}
