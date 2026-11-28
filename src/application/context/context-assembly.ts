import type { ContextFileInput } from "@ollama-client/contracts/context"
import {
  ACTIVITY_LABELS,
  type ActivityLabel,
  CONTEXT_CHUNK_LABELS
} from "@/application/context/activity-labels"
import type {
  ActivityEvent,
  RagSource,
  RagSources,
  UsedContextChunk
} from "@/types"
import type { ContextPlan } from "./context-plan"
import { remainingRagBudget } from "./context-plan"

export interface PromptContextStats {
  selection?: import("@ollama-client/contracts/context").ContextSelection
  promptInputLength: number
  promptAugmentedLength: number
  tabContextLength: number
  ragContextLength: number
  tabContextTruncated: boolean
  groundedOnlyMode: boolean
  insufficientContext: boolean
  usedContextChunks: UsedContextChunk[]
  activityEvents: ActivityEvent[]
}

export interface ContextAssemblyResult {
  contentWithRAG: string
  /** The Agent runs whose fenced record this turn carries. */
  agentHandoffRunIds: string[]
  ragSources: RagSources | null
  promptContextStats: PromptContextStats
  pageContextAdded: boolean
}

const SEPARATOR = "\n\n---\n\n"
const CITATION_INSTRUCTION = "Cite document evidence as [doc-N].\n\n"

/** Pack structured evidence first; the receipt describes exactly these accepted bytes. */
const packSources = (
  sources: RagSource[],
  budget: number,
  citationCount: number
) => {
  const accepted: RagSource[] = []
  const blocks: string[] = []
  let remaining = Math.max(0, budget)
  for (const source of sources) {
    const tag =
      source.type === "memory" || source.type === "chat" ? "memory" : "doc"
    if (!source.content) continue
    const citationId = tag === "doc" ? citationCount + 1 : undefined
    const citationInstruction = citationId === 1 ? CITATION_INSTRUCTION : ""
    const citation = citationId ? ` id="doc-${citationId}"` : ""
    const page = source.page ? ` page="${source.page}"` : ""
    const title = source.title.replace(/[&<>"']/g, " ")
    const prefix = `<${tag}${citation} source="${title}"${page}>\n`
    const suffix = `\n</${tag}>`
    const separator = blocks.length ? "\n\n" : ""
    const available =
      remaining -
      prefix.length -
      suffix.length -
      separator.length -
      citationInstruction.length
    if (available <= 0) break
    const content = source.content.slice(0, available)
    const block = `${separator}${citationInstruction}${prefix}${content}${suffix}`
    blocks.push(block)
    citationCount = citationId ?? citationCount
    accepted.push({
      ...source,
      citationId,
      content,
      partial: content.length < source.content.length || source.partial
    })
    remaining -= block.length
    if (content.length < source.content.length) break
  }
  return { text: blocks.join(""), sources: accepted, citationCount }
}

/**
 * Owns deterministic prompt assembly and telemetry for one context build.
 * Environment-facing retrieval stays in the orchestrator; this object is the
 * single mutation boundary for budgets, source receipts, and activity events.
 */
export class ContextAssembly {
  private contentWithRAG: string
  private tabContextLength = 0
  private ragContextLength = 0
  private tabContextTruncated = false
  private readonly usedContextChunks: UsedContextChunk[] = []
  private readonly activityEvents: ActivityEvent[] = []
  private ragSources: RagSources | null = null
  private pageContextAdded = false
  private ragInstructionAdded = false
  private citationCount = 0
  private agentHandoffRunIds: string[] = []

  constructor(
    private readonly plan: ContextPlan,
    private readonly groundedOnlyMode: boolean,
    private readonly onActivityEvent?: (events: ActivityEvent[]) => void,
    private ragInstruction = ""
  ) {
    this.contentWithRAG = plan.userContent
  }

  get remainingRagBudget(): number {
    return remainingRagBudget(
      this.plan,
      this.ragContextLength + this.tabContextLength
    )
  }

  setRagInstruction(instruction: string): void {
    this.ragInstruction = instruction
  }

  startActivity(
    id: string,
    kind: ActivityEvent["kind"],
    label: ActivityLabel,
    inputPreview?: string
  ): ActivityEvent {
    const event: ActivityEvent = {
      id,
      kind,
      label: label.text,
      labelKey: label.key,
      status: "running",
      startedAt: Date.now(),
      inputPreview
    }
    this.upsertActivity(event)
    return event
  }

  finishActivity(
    event: ActivityEvent,
    updates: Partial<ActivityEvent> = {}
  ): void {
    this.upsertActivity({
      ...event,
      ...updates,
      status: updates.status ?? "done",
      finishedAt: Date.now()
    })
  }

  recordError(error: unknown): void {
    const now = Date.now()
    this.upsertActivity({
      id: "rag-error",
      kind: "searching_memory",
      label: ACTIVITY_LABELS.searchingContext.text,
      labelKey: ACTIVITY_LABELS.searchingContext.key,
      status: "error",
      startedAt: now,
      finishedAt: now,
      error: error instanceof Error ? error.message : "Context search failed"
    })
  }

  appendPageContext(
    sources: RagSource[],
    query: string,
    maxChars: number
  ): void {
    const packed = this.appendSources(
      sources,
      Math.min(maxChars, this.remainingRagBudget),
      "tab"
    )
    this.tabContextTruncated ||=
      packed.some((source) => source.partial) || packed.length < sources.length
    if (packed.length) {
      this.mergeSources(packed, query)
      this.addUsedChunks(packed, () => "tab")
      this.pageContextAdded = true
    }
  }

  appendStoredContext(
    sources: RagSource[],
    query: string,
    sourceFor: (source: RagSource) => UsedContextChunk["source"]
  ): void {
    const packed = this.appendSources(
      sources,
      this.remainingRagBudget,
      "stored"
    )
    if (packed.length) {
      this.mergeSources(packed, query)
      this.addUsedChunks(packed, sourceFor)
    }
  }

  appendTabFallback(contextText: string, maxChars: number): void {
    if (this.pageContextAdded) return
    const available = Math.max(
      0,
      Math.min(maxChars, this.remainingRagBudget) -
        (this.contentWithRAG ? SEPARATOR.length : 0)
    )
    const text = contextText.slice(0, available)
    if (!text) return
    this.tabContextLength +=
      text.length + (this.contentWithRAG ? SEPARATOR.length : 0)
    this.appendPlainContext(text)
    this.tabContextTruncated ||= text.length < contextText.length
    this.pageContextAdded = true
    this.usedContextChunks.push({
      id: "tab-fallback",
      title: CONTEXT_CHUNK_LABELS.selectedTabContext.text,
      titleKey: CONTEXT_CHUNK_LABELS.selectedTabContext.key,
      excerpt: text.slice(0, 220),
      partial: text.length < contextText.length,
      score: 0.5,
      sectionPath: "fallback-full-context",
      source: "tab"
    })
  }

  /**
   * The fenced records of earlier Agent runs in this branch, counted against
   * the same budget as retrieved context so the two never claim the window
   * twice. The caller sized the block from `remainingRagBudget`.
   */
  appendAgentHandoffs(context: { block?: string; runIds: string[] }): void {
    if (!context.block) return
    const size =
      context.block.length + (this.contentWithRAG ? SEPARATOR.length : 0)
    if (size > this.remainingRagBudget) return
    this.appendPlainContext(context.block)
    this.ragContextLength += size
    this.agentHandoffRunIds = context.runIds
  }

  appendFileContext(
    files: ContextFileInput[] | undefined,
    retrieved: RagSource[] = [],
    query = this.plan.initialRetrievalQuery
  ): void {
    if (this.groundedOnlyMode) return

    const remaining = new Map<string, RagSource[]>()
    for (const source of retrieved) {
      if (!source.fileId) continue
      const matches = remaining.get(source.fileId) ?? []
      matches.push(source)
      remaining.set(source.fileId, matches)
    }

    const seen = new Set<string>()
    const attachments = (files ?? []).filter((file) => {
      const id = file.metadata.fileId
      if (id && seen.has(id)) return false
      if (id) seen.add(id)
      return Boolean(
        file.text || file.pages?.length || (id && remaining.has(id))
      )
    })
    const appendAttachment = (index: number, shares: number) => {
      const file = attachments[index]
      const { fileId, fileName } = file.metadata
      const matches = fileId ? (remaining.get(fileId) ?? []) : []
      const overhead =
        this.pendingRagInstruction.length +
        (this.citationCount === 0 ? CITATION_INSTRUCTION.length : 0)
      const budget = Math.min(
        this.remainingRagBudget,
        overhead + Math.floor((this.remainingRagBudget - overhead) / shares)
      )
      const packed = this.appendSources(matches, budget, "stored")
      const baseSource = {
        id: fileId ?? `attached-${index}`,
        fileId,
        title: fileName,
        score: 1,
        source: "file",
        type: "file"
      }
      const pages = file.pages?.filter((page) => page.text.trim())
      const accepted = packed.length
        ? packed
        : this.appendSources(
            pages?.length
              ? pages.map((page) => ({
                  ...baseSource,
                  content: page.text,
                  page: page.pageNumber
                }))
              : [{ ...baseSource, content: file.text }],
            budget,
            "stored"
          )
      if (accepted.length) {
        this.mergeSources(accepted, query)
        this.addUsedChunks(accepted, () => "file")
      }
      return accepted.length > 0
    }

    // A long title can exceed its fair share before even one character fits.
    // Retry skipped files after shorter attachments have released their shares.
    const skipped: number[] = []
    for (const index of attachments.keys()) {
      if (!appendAttachment(index, attachments.length - index))
        skipped.push(index)
    }
    for (const index of skipped) appendAttachment(index, 1)

    this.appendStoredContext(
      retrieved.filter((source) => !source.fileId || !seen.has(source.fileId)),
      query,
      (source) => source.source
    )
  }

  finish(): ContextAssemblyResult {
    const insufficientContext =
      this.groundedOnlyMode && this.tabContextLength === 0
    if (this.groundedOnlyMode && !insufficientContext) {
      const instruction = `You must answer only from the supplied selected-page context. If context is insufficient, respond with: "Insufficient page context."`
      this.contentWithRAG = `${instruction}\n\n${this.contentWithRAG}`
    }

    return {
      contentWithRAG: this.contentWithRAG,
      agentHandoffRunIds: this.agentHandoffRunIds,
      ragSources: this.ragSources,
      promptContextStats: {
        promptInputLength: this.plan.userContent.length,
        promptAugmentedLength: this.contentWithRAG.length,
        tabContextLength: this.tabContextLength,
        ragContextLength: this.ragContextLength,
        tabContextTruncated: this.tabContextTruncated,
        groundedOnlyMode: this.groundedOnlyMode,
        insufficientContext,
        usedContextChunks: this.usedContextChunks,
        activityEvents: this.activityEvents
      },
      pageContextAdded: this.pageContextAdded
    }
  }

  private get pendingRagInstruction(): string {
    return !this.ragInstructionAdded && this.ragInstruction
      ? `${this.ragInstruction}\n\n`
      : ""
  }

  private appendSources(
    sources: RagSource[],
    budget: number,
    kind: "tab" | "stored"
  ): RagSource[] {
    if (!sources.some((source) => source.content)) return []
    const instruction = this.pendingRagInstruction
    const separatorSize = this.contentWithRAG ? SEPARATOR.length : 0
    const packed = packSources(
      sources,
      budget - instruction.length - separatorSize,
      this.citationCount
    )
    if (!packed.sources.length) return []
    this.citationCount = packed.citationCount
    const block = instruction + packed.text
    if (kind === "tab") this.tabContextLength += block.length + separatorSize
    else this.ragContextLength += block.length + separatorSize
    this.ragInstructionAdded = true
    this.appendPlainContext(block)
    return packed.sources
  }

  private appendPlainContext(context: string): void {
    this.contentWithRAG = this.contentWithRAG
      ? `${this.contentWithRAG}${SEPARATOR}${context}`
      : context
  }

  private mergeSources(sources: RagSource[], query: string): void {
    this.ragSources = {
      sources: [...(this.ragSources?.sources || []), ...sources],
      query
    }
  }

  private addUsedChunks(
    sources: RagSource[],
    sourceFor: (source: RagSource) => UsedContextChunk["source"]
  ): void {
    for (const source of sources) {
      this.usedContextChunks.push({
        id: source.id,
        title: source.title,
        excerpt: source.content.slice(0, 220),
        score: source.score,
        sectionPath: source.source || source.type,
        source: sourceFor(source),
        chunkIndex: source.chunkIndex,
        fileId: source.fileId,
        citationId: source.citationId,
        page: source.page,
        partial: source.partial
      })
    }
  }

  private upsertActivity(event: ActivityEvent): void {
    const index = this.activityEvents.findIndex((item) => item.id === event.id)
    if (index >= 0) this.activityEvents[index] = event
    else this.activityEvents.push(event)
    this.onActivityEvent?.([...this.activityEvents])
  }
}
