import {
  type AgentPageTool,
  AgentPageToolSchema,
  MAX_AGENT_PAGE_TOOL_SCHEMA_CHARS,
  MAX_AGENT_PAGE_TOOLS
} from "@ollama-client/contracts"

const MAX_PAGE_TOOL_RESULT_CHARS = 1_800

interface RegisteredPageTool {
  name: string
  title?: string
  description: string
  inputSchema?: Record<string, unknown>
  origin?: string
  annotations?: {
    readOnlyHint?: boolean
    consequentialHint?: boolean
    untrustedContentHint?: boolean
  }
}

interface ModelContextLike {
  getTools(): Promise<RegisteredPageTool[]>
  executeTool(
    tool: RegisteredPageTool,
    input: Record<string, unknown>,
    options?: { signal?: AbortSignal }
  ): Promise<unknown>
}

const modelContextOf = (document: Document): ModelContextLike | undefined =>
  (document as Document & { modelContext?: ModelContextLike }).modelContext

/** Small deterministic digest; identity, not a cryptographic claim. */
const revisionOf = (value: unknown): string => {
  const text = JSON.stringify(value)
  let hash = 0x811c9dc5
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16).padStart(8, "0")
}

const publicTool = (
  tool: RegisteredPageTool,
  input: { frameId: number; documentId: string; origin: string }
): AgentPageTool | undefined => {
  let inputSchema: Record<string, unknown>
  try {
    const serialized = JSON.stringify(tool.inputSchema ?? {})
    if (serialized.length > MAX_AGENT_PAGE_TOOL_SCHEMA_CHARS) return undefined
    inputSchema = JSON.parse(serialized) as Record<string, unknown>
  } catch {
    return undefined
  }
  const descriptor = {
    name: tool.name,
    ...(tool.title ? { title: tool.title } : {}),
    description: tool.description,
    inputSchema,
    ...(tool.annotations
      ? {
          annotations: {
            ...(tool.annotations.readOnlyHint === undefined
              ? {}
              : { readOnlyHint: tool.annotations.readOnlyHint }),
            ...(tool.annotations.consequentialHint === undefined
              ? {}
              : { consequentialHint: tool.annotations.consequentialHint }),
            ...(tool.annotations.untrustedContentHint === undefined
              ? {}
              : {
                  untrustedContentHint: tool.annotations.untrustedContentHint
                })
          }
        }
      : {}),
    frameId: input.frameId,
    documentId: input.documentId,
    origin: tool.origin ?? input.origin
  }
  const parsed = AgentPageToolSchema.safeParse({
    ...descriptor,
    schemaRevision: revisionOf(descriptor)
  })
  return parsed.success ? parsed.data : undefined
}

export const discoverAgentPageTools = async (input: {
  document: Document
  frameId: number
  documentId: string
}): Promise<AgentPageTool[]> => {
  const context = modelContextOf(input.document)
  if (!context) return []
  const origin = input.document.location.origin
  const tools = await context.getTools()
  return tools
    .slice(0, MAX_AGENT_PAGE_TOOLS)
    .map((tool) => publicTool(tool, { ...input, origin }))
    .filter((tool): tool is AgentPageTool => tool !== undefined)
}

export type AgentPageToolExecution =
  | { type: "executed"; result: string; navigation: boolean }
  | { type: "stale" }

/**
 * Re-discover immediately before execution. A `toolchange` or navigation
 * therefore invalidates the revision the model chose before page code runs.
 */
export const executeAgentPageTool = async (input: {
  document: Document
  frameId: number
  documentId: string
  name: string
  schemaRevision: string
  args: Record<string, unknown>
  signal?: AbortSignal
}): Promise<AgentPageToolExecution> => {
  const context = modelContextOf(input.document)
  if (!context) return { type: "stale" }
  const tools = await context.getTools()
  const tool = tools.find((candidate) => candidate.name === input.name)
  if (!tool) return { type: "stale" }
  const exposed = publicTool(tool, {
    frameId: input.frameId,
    documentId: input.documentId,
    origin: input.document.location.origin
  })
  if (!exposed || exposed.schemaRevision !== input.schemaRevision) {
    return { type: "stale" }
  }
  const value = await context.executeTool(tool, input.args, {
    signal: input.signal
  })
  const navigation = value === null
  const serialized =
    typeof value === "string"
      ? value
      : value === null
        ? ""
        : (JSON.stringify(value) ?? "")
  return {
    type: "executed",
    result: serialized.slice(0, MAX_PAGE_TOOL_RESULT_CHARS),
    navigation
  }
}
