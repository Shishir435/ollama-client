import type { ResolvedModelTools } from "@/background/lib/resolve-model-tools"

/**
 * Model-callable tools that let the model retrieve stored file / conversation
 * context itself. When any is offered this turn, the harness must NOT
 * pre-inject that context (file RAG or conversation memory) — the model pulls
 * it on demand, keeping the prompt clean and avoiding retrieving the same
 * store twice. Shared by the context builder and the legacy send/regenerate
 * path so both gate identically.
 */
export const RETRIEVAL_TOOL_NAMES = new Set(["rag_search", "file_search"])

/** Whether a resolved tool set includes any retrieval tool. */
export const hasRetrievalTool = (
  resolved: ResolvedModelTools | null | undefined
): boolean =>
  Boolean(resolved?.tools.some((tool) => RETRIEVAL_TOOL_NAMES.has(tool.name)))
