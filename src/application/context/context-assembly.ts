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
  ragSources: RagSources | null
  promptContextStats: PromptContextStats
  pageContextAdded: boolean
}

const clampContext = (value: string, maxChars: number) => {
  if (value.length <= maxChars) return { text: value, truncated: false }
  return {
    text: `${value.slice(0, maxChars)}\n\n[Context truncated due to length]`,
    truncated: true
  }
}

const buildFileFullTextFallback = (files: ContextFileInput[]) =>
  files
    .map(
      (file) =>
        `[File: ${file.metadata.fileName}]\n${file.text.slice(0, 10000)}${
          file.text.length > 10000 ? "\n... (truncated)" : ""
        }`
    )
    .join("\n\n---\n\n")

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

  constructor(
    private readonly plan: ContextPlan,
    private readonly groundedOnlyMode: boolean,
    private readonly onActivityEvent?: (events: ActivityEvent[]) => void,
    private ragInstruction = ""
  ) {
    this.contentWithRAG = plan.userContent
  }

  get remainingRagBudget(): number {
    return remainingRagBudget(this.plan, this.ragContextLength)
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
    formattedContext: string,
    sources: RagSource[],
    query: string,
    maxChars: number
  ): void {
    const clamped = clampContext(formattedContext, maxChars)
    this.appendRagContext(clamped.text)
    this.tabContextLength += clamped.text.length
    this.tabContextTruncated ||= clamped.truncated
    this.mergeSources(sources, query)
    this.addUsedChunks(sources, () => "tab")
    this.pageContextAdded = true
  }

  appendStoredContext(
    formattedContext: string,
    sources: RagSource[],
    query: string,
    sourceFor: (source: RagSource) => UsedContextChunk["source"]
  ): void {
    const clamped = clampContext(formattedContext, this.remainingRagBudget)
    this.appendRagContext(clamped.text)
    this.ragContextLength += clamped.text.length
    this.mergeSources(sources, query)
    this.addUsedChunks(sources, sourceFor)
  }

  appendTabFallback(contextText: string, maxChars: number): void {
    if (this.pageContextAdded) return
    const clamped = clampContext(contextText, maxChars)
    this.appendPlainContext(clamped.text)
    this.tabContextLength += clamped.text.length
    this.tabContextTruncated ||= clamped.truncated
    this.usedContextChunks.push({
      id: "tab-fallback",
      title: CONTEXT_CHUNK_LABELS.selectedTabContext.text,
      titleKey: CONTEXT_CHUNK_LABELS.selectedTabContext.key,
      excerpt: clamped.text.slice(0, 220),
      score: 0.5,
      sectionPath: "fallback-full-context",
      source: "tab"
    })
  }

  appendFileFallback(files: ContextFileInput[] | undefined): void {
    if (this.contentWithRAG !== this.plan.userContent || !files?.length) return
    this.contentWithRAG = `${this.contentWithRAG}\n\n---\n\n${buildFileFullTextFallback(files)}`
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

  private appendRagContext(context: string): void {
    const block =
      !this.ragInstructionAdded && this.ragInstruction
        ? `${this.ragInstruction}\n\n${context}`
        : context
    this.ragInstructionAdded = true
    this.appendPlainContext(block)
  }

  private appendPlainContext(context: string): void {
    this.contentWithRAG = this.contentWithRAG
      ? `${this.contentWithRAG}\n\n---\n\n${context}`
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
        chunkIndex: source.chunkIndex
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
