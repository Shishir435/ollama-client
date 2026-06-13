import { DEFAULT_MAX_TOOL_RESULT_CHARS } from "@/lib/constants"
import type { ToolDefinition, ToolRuntimePolicy } from "./types"

export const DEFAULT_TOOL_TIMEOUT_MS = 60_000

export const DEFAULT_TOOL_RUNTIME_POLICY: ToolRuntimePolicy = {
  timeoutMs: DEFAULT_TOOL_TIMEOUT_MS,
  maxResultChars: DEFAULT_MAX_TOOL_RESULT_CHARS,
  cacheable: false,
  parallelizable: true,
  enabled: true
}

export const resolveToolRuntimePolicy = (
  definition?: ToolDefinition,
  overrides: Partial<ToolRuntimePolicy> = {}
): ToolRuntimePolicy => ({
  ...DEFAULT_TOOL_RUNTIME_POLICY,
  cacheable: definition?.cacheable ?? DEFAULT_TOOL_RUNTIME_POLICY.cacheable,
  ...definition?.runtime,
  ...overrides
})
