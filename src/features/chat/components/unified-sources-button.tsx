import { BookOpen } from "lucide-react"
import { useTranslation } from "react-i18next"
import type { RagSource, ToolRun } from "@/types"
import { MessageSourcesSheet, type SourceItem } from "./message-sources-sheet"
import {
  hostOf,
  SearchEngineBadge,
  WebSourceFavicon
} from "./web-search-sources-button"

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
  tabContextLength?: number
  ragContextLength?: number
  tabContextTruncated?: boolean
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
  tabContextLength,
  ragContextLength,
  tabContextTruncated,
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
          kind: "knowledge"
        }))
      : usedContextChunks
          .filter((chunk) => chunk.source === "rag")
          .map((chunk) => ({
            id: `knowledge-${chunk.id}-${chunk.chunkIndex ?? 0}`,
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

  const sections = [
    pageItems.length
      ? {
          label: t("chat.sources.unified_page", { count: pageItems.length }),
          items: pageItems
        }
      : null,
    ragItems.length
      ? {
          label: t("chat.sources.unified_knowledge", {
            count: ragItems.length
          }),
          items: ragItems
        }
      : null,
    usedWebItems.length
      ? {
          label: t("chat.sources.unified_web", {
            count: usedWebItems.length
          }),
          items: usedWebItems
        }
      : null,
    unusedWebItems.length
      ? {
          label: t("chat.sources.web_unused_label", {
            count: unusedWebItems.length
          }),
          items: unusedWebItems
        }
      : null
  ].filter(
    (
      section
    ): section is {
      label: string
      items: SourceItem[]
    } => Boolean(section)
  )

  const total = sections.reduce(
    (count, section) => count + section.items.length,
    0
  )
  if (total === 0) return null

  return (
    <MessageSourcesSheet
      icon={<BookOpen className="icon-xs" />}
      badgeCount={total}
      tooltip={t("chat.sources.unified_tooltip", { count: total })}
      ariaLabel={t("chat.sources.unified_aria", { count: total })}
      title={t("chat.sources.unified_title", { count: total })}
      sections={sections}
      metadataPosition="before-title"
      preContent={
        <div className="space-y-1 text-micro text-muted-foreground">
          {(tabContextLength || ragContextLength) && (
            <p>
              {t("chat.sources.char_counts", {
                tab: tabContextLength || 0,
                rag: ragContextLength || 0
              })}
              {tabContextTruncated ? ` · ${t("chat.sources.trimmed")}` : ""}
            </p>
          )}
          {unusedWebItems.length > 0 && (
            <p>{t("chat.sources.web_unused_hint")}</p>
          )}
        </div>
      }
      renderMetadata={(item) => {
        if (item.kind === "web" && item.url) {
          const host = hostOf(item.url) ?? item.url
          return (
            <span className="inline-flex max-w-full items-center gap-1.5">
              <a
                href={item.url}
                target="_blank"
                rel="noreferrer"
                title={item.url}
                onClick={(event) => event.stopPropagation()}
                className="inline-flex min-w-0 items-center gap-1 text-primary underline-offset-2 hover:underline">
                <WebSourceFavicon url={item.url} />
                <span className="min-w-0 truncate">{host}</span>
              </a>
              <SearchEngineBadge engine={item.engine} />
            </span>
          )
        }
        return (
          <>
            {item.score > 0 ? `score: ${item.score.toFixed(2)}` : ""}
            {item.sectionPath ? ` · ${item.sectionPath}` : ""}
            {item.source && item.source !== "rag" ? ` · ${item.source}` : ""}
          </>
        )
      }}
      renderContent={(item) => (
        <div className="space-y-2">
          {item.publishedAt && (
            <p className="text-micro text-muted-foreground/75">
              {t("chat.sources.web_published", { date: item.publishedAt })}
            </p>
          )}
          <p className="whitespace-pre-wrap wrap-anywhere text-2xs text-muted-foreground">
            {item.content || t("chat.sources.web_no_snippet")}
          </p>
        </div>
      )}
      feedback={
        feedbackEnabled
          ? {
              query: ragQuery ?? "",
              isEnabled: (item) => item.kind === "knowledge"
            }
          : undefined
      }
    />
  )
}
