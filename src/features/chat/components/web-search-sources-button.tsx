import { useTranslation } from "react-i18next"
import { ExternalLink, Globe } from "@/lib/lucide-icon"
import type { ToolRun } from "@/types"
import { MessageSourcesSheet, type SourceItem } from "./message-sources-sheet"

export interface WebSearchSourcesButtonProps {
  toolRuns?: ToolRun[]
}

type WebSource = NonNullable<ToolRun["sources"]>[number]

const hostOf = (url?: string): string | undefined => {
  if (!url) return undefined
  try {
    return new URL(url).hostname.replace(/^www\./, "")
  } catch {
    return undefined
  }
}

const toItem = (source: WebSource, index: number): SourceItem => ({
  id: source.url ?? `web-${index}`,
  title: source.title,
  content: source.excerpt ?? "",
  score: 0,
  // Carry the URL through `source` so renderMetadata can link to it.
  source: source.url
})

/**
 * Surfaces web_search sources in the right sheet (reusing MessageSourcesSheet):
 * the results actually sent to the model ("used") and the remainder the
 * provider returned but the cap left out ("also found"), so users can see what
 * grounded the answer and decide whether to raise the result count.
 */
export function WebSearchSourcesButton({
  toolRuns
}: WebSearchSourcesButtonProps) {
  const { t } = useTranslation()

  const sources = (toolRuns ?? [])
    .filter((run) => run.category === "web" || run.toolId === "web_search")
    .flatMap((run) => run.sources ?? [])
  if (sources.length === 0) return null

  const used = sources.filter((s) => s.used)
  const unused = sources.filter((s) => !s.used)
  const total = sources.length

  const sections: { label?: string; items: SourceItem[] }[] = []
  if (used.length > 0) {
    sections.push({
      label: t("chat.sources.web_used_label", { count: used.length }),
      items: used.map(toItem)
    })
  }
  if (unused.length > 0) {
    sections.push({
      label: t("chat.sources.web_unused_label", { count: unused.length }),
      items: unused.map(toItem)
    })
  }

  return (
    <MessageSourcesSheet
      icon={<Globe className="icon-xs" />}
      badgeCount={total}
      tooltip={t("chat.sources.web_source", { count: total })}
      ariaLabel={t("chat.sources.view_web", { count: total })}
      title={t("chat.sources.web_title", { count: total })}
      sections={sections}
      preContent={
        unused.length > 0 ? (
          <p className="text-[11px] text-muted-foreground">
            {t("chat.sources.web_unused_hint")}
          </p>
        ) : undefined
      }
      renderMetadata={(item) => {
        const url = item.source
        if (!url) return null
        const host = hostOf(url) ?? url
        return (
          <a
            href={url}
            target="_blank"
            rel="noreferrer"
            title={url}
            // Stop the accordion trigger from toggling when opening the link.
            onClick={(e) => e.stopPropagation()}
            className="inline-flex max-w-full items-center gap-1 text-primary underline-offset-2 hover:underline">
            <ExternalLink className="size-3 shrink-0" aria-hidden />
            <span className="min-w-0 truncate">{host}</span>
          </a>
        )
      }}
    />
  )
}
