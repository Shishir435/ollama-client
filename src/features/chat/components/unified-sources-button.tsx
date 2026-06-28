import { useTranslation } from "react-i18next"
import type { RagSource, ToolRun } from "@/types"
import type { SourceItem } from "./message-sources-sheet"
import {
  type UnifiedSection,
  UnifiedSourcesSheet
} from "./unified-sources-sheet"

type UsedChunk = {
  id: string | number
  title: string
  excerpt: string
  score: number
  sectionPath?: string
  source?: string
  chunkIndex?: number
}

export interface UnifiedSourcesButtonProps {
  ragSources?: RagSource[] | null
  ragQuery?: string
  usedContextChunks?: UsedChunk[]
  toolRuns?: ToolRun[]
  showRetrievedChunks?: boolean
  feedbackEnabled?: boolean
}

const webSourcesFrom = (toolRuns: ToolRun[]) =>
  toolRuns
    .filter((run) => run.category === "web" || run.toolId === "web_search")
    .flatMap((run) => run.sources ?? [])

export function UnifiedSourcesButton({
  ragSources,
  ragQuery,
  usedContextChunks = [],
  toolRuns = [],
  showRetrievedChunks = true,
  feedbackEnabled = true
}: UnifiedSourcesButtonProps) {
  const { t } = useTranslation()
  const pageItems: SourceItem[] = usedContextChunks
    .filter((chunk) => chunk.source !== "rag")
    .map((chunk) => ({
      id: `page-${chunk.id}-${chunk.chunkIndex ?? 0}`,
      title: chunk.title,
      content: chunk.excerpt,
      score: chunk.score,
      sectionPath: chunk.sectionPath,
      source: chunk.source,
      chunkIndex: chunk.chunkIndex,
      kind: "page"
    }))

  const ragItems: SourceItem[] =
    showRetrievedChunks && ragSources?.length
      ? ragSources.map((source, index) => ({
          ...source,
          id: `knowledge-${source.id}-${index}`,
          chunkId: source.id,
          kind: "knowledge"
        }))
      : usedContextChunks
          .filter((chunk) => chunk.source === "rag")
          .map((chunk) => ({
            id: `knowledge-${chunk.id}-${chunk.chunkIndex ?? 0}`,
            chunkId: chunk.id,
            title: chunk.title,
            content: chunk.excerpt,
            score: chunk.score,
            sectionPath: chunk.sectionPath,
            source: chunk.source,
            chunkIndex: chunk.chunkIndex,
            kind: "knowledge"
          }))

  const webSources = webSourcesFrom(toolRuns)
  const webItems: SourceItem[] = webSources.map((source, index) => ({
    id: `web-${source.id ?? source.url ?? index}-${index}`,
    title: source.title,
    content: source.excerpt ?? "",
    score: 0,
    source: source.source,
    url: source.url,
    engine: source.source,
    publishedAt: source.publishedAt,
    kind: "web"
  }))
  const usedWebItems = webItems.filter(
    (_, index) => webSources[index]?.used !== false
  )
  const unusedWebItems = webItems.filter(
    (_, index) => webSources[index]?.used === false
  )

  const sections: UnifiedSection[] = (
    [
      pageItems.length
        ? {
            group: "local",
            label: t("chat.sources.unified_page", { count: pageItems.length }),
            items: pageItems
          }
        : null,
      ragItems.length
        ? {
            group: "knowledge",
            label: t("chat.sources.unified_knowledge", {
              count: ragItems.length
            }),
            items: ragItems
          }
        : null,
      usedWebItems.length
        ? {
            group: "web",
            label: t("chat.sources.unified_web", {
              count: usedWebItems.length
            }),
            items: usedWebItems
          }
        : null,
      unusedWebItems.length
        ? {
            group: "web",
            label: t("chat.sources.web_unused_label", {
              count: unusedWebItems.length
            }),
            items: unusedWebItems,
            unused: true
          }
        : null
    ] as (UnifiedSection | null)[]
  ).filter((section): section is UnifiedSection => Boolean(section))

  const total = sections.reduce(
    (count, section) => count + section.items.length,
    0
  )
  if (total === 0) return null

  return (
    <UnifiedSourcesSheet
      badgeCount={total}
      tooltip={t("chat.sources.unified_tooltip", { count: total })}
      ariaLabel={t("chat.sources.unified_aria", { count: total })}
      title={t("chat.sources.unified_title", { count: total })}
      subtitle={t("chat.sources.subtitle")}
      note={
        unusedWebItems.length > 0
          ? t("chat.sources.web_unused_hint")
          : undefined
      }
      sections={sections}
      feedback={feedbackEnabled ? { query: ragQuery ?? "" } : undefined}
    />
  )
}
