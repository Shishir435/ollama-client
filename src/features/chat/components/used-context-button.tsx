import { FileSearch } from "lucide-react"
import { useTranslation } from "react-i18next"
import { MessageSourcesSheet, type SourceItem } from "./message-sources-sheet"

type UsedChunk = {
  id: string | number
  title: string
  excerpt: string
  score: number
  sectionPath?: string
  source?: string
  chunkIndex?: number
}

export const UsedContextButton = ({
  chunks,
  tabContextLength,
  ragContextLength,
  tabContextTruncated
}: {
  chunks: UsedChunk[]
  tabContextLength?: number
  ragContextLength?: number
  tabContextTruncated?: boolean
}) => {
  const { t } = useTranslation()
  if (!chunks || chunks.length === 0) return null

  const tabChunks = chunks.filter((chunk) => chunk.source !== "rag")
  const ragChunks = chunks.filter((chunk) => chunk.source === "rag")

  const toSourceItem = (c: UsedChunk): SourceItem => ({
    id: c.id,
    title: c.title,
    content: c.excerpt,
    score: c.score,
    chunkIndex: c.chunkIndex,
    source: c.source,
    sectionPath: c.sectionPath
  })

  const sections: { label?: string; items: SourceItem[] }[] = []
  if (tabChunks.length > 0) {
    sections.push({
      label: t("chat.sources.tab_context_label", { count: tabChunks.length }),
      items: tabChunks.map(toSourceItem)
    })
  }
  if (ragChunks.length > 0) {
    sections.push({
      label: t("chat.sources.rag_context_label", { count: ragChunks.length }),
      items: ragChunks.map(toSourceItem)
    })
  }

  return (
    <MessageSourcesSheet
      icon={<FileSearch className="icon-xs" />}
      badgeCount={chunks.length}
      tooltip={t("chat.sources.used_context_tooltip")}
      ariaLabel={t("chat.sources.used_context_aria", { count: chunks.length })}
      title={t("chat.sources.used_context_title", { count: chunks.length })}
      sections={sections}
      preContent={
        <div className="text-[10px] text-muted-foreground">
          {t("chat.sources.char_counts", {
            tab: tabContextLength || 0,
            rag: ragContextLength || 0
          })}
          {tabContextTruncated ? ` | ${t("chat.sources.trimmed")}` : ""}
        </div>
      }
      renderMetadata={(item) => (
        <>
          score: {item.score.toFixed(2)}
          {item.sectionPath ? ` | ${item.sectionPath}` : ""}
        </>
      )}
      getItemValue={(item) => `${item.id}-${item.chunkIndex ?? 0}`}
    />
  )
}
