import { useState } from "react"
import { useTranslation } from "react-i18next"
import { runtime } from "@/lib/browser-api"
import { Globe } from "@/lib/lucide-icon"
import type { ToolRun } from "@/types"
import { MessageSourcesSheet, type SourceItem } from "./message-sources-sheet"

export interface WebSearchSourcesButtonProps {
  toolRuns?: ToolRun[]
}

type WebSource = NonNullable<ToolRun["sources"]>[number]
type IndexedWebSource = { source: WebSource; itemId: string }

const SEARCH_ENGINE_BADGES: Record<
  string,
  { label: string; asset: string; className: string }
> = {
  brave: {
    label: "Brave",
    asset: "assets/search-engines/brave.svg",
    className: "bg-orange-500/15"
  },
  duckduckgo: {
    label: "DDG",
    asset: "assets/search-engines/duckduckgo.svg",
    className: "bg-red-500/15"
  },
  google: {
    label: "Google",
    asset: "assets/search-engines/google.svg",
    className: "bg-blue-500/15"
  },
  bing: {
    label: "Bing",
    asset: "assets/search-engines/bing.svg",
    className: "bg-cyan-500/15"
  },
  wikipedia: {
    label: "Wikipedia",
    asset: "assets/search-engines/wikipedia.svg",
    className: "bg-zinc-500/15"
  }
}

const hostOf = (url?: string): string | undefined => {
  if (!url) return undefined
  try {
    return new URL(url).hostname.replace(/^www\./, "")
  } catch {
    return undefined
  }
}

const normalizeSearchEngine = (engine?: string): string | undefined => {
  const normalized = engine
    ?.trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, "")
  if (!normalized) return undefined
  if (normalized.includes("duckduckgo")) return "duckduckgo"
  if (normalized.includes("brave")) return "brave"
  if (normalized.includes("google")) return "google"
  if (normalized.includes("bing")) return "bing"
  if (normalized.includes("wikipedia")) return "wikipedia"
  return undefined
}

export const getWebSourceFaviconUrl = (url?: string): string | undefined => {
  if (!url) return undefined
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:")
      return undefined
    return new URL("/favicon.ico", parsed.origin).toString()
  } catch {
    return undefined
  }
}

const toItem = ({ source, itemId }: IndexedWebSource): SourceItem => ({
  id: itemId,
  title: source.title,
  content: source.excerpt ?? "",
  score: 0,
  // Carry the URL through `source` so renderMetadata can link to it.
  source: source.url
})

function WebSourceFavicon({ url }: { url?: string }) {
  const [failed, setFailed] = useState(false)
  const faviconUrl = getWebSourceFaviconUrl(url)
  if (!faviconUrl || failed) {
    return <Globe className="size-3.5 shrink-0" aria-hidden />
  }
  return (
    <img
      src={faviconUrl}
      alt=""
      aria-hidden
      className="size-3.5 shrink-0 rounded-[2px]"
      loading="lazy"
      onError={() => setFailed(true)}
    />
  )
}

function SearchEngineBadge({ engine }: { engine?: string }) {
  const badge = SEARCH_ENGINE_BADGES[normalizeSearchEngine(engine) ?? ""]
  if (!badge) return null
  return (
    <span
      title={badge.label}
      className={`inline-flex size-4 shrink-0 items-center justify-center rounded ${badge.className}`}>
      <img
        src={runtime.getURL(badge.asset)}
        alt=""
        aria-hidden
        className="size-3"
        loading="lazy"
      />
    </span>
  )
}

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

  const indexedSources: IndexedWebSource[] = sources.map((source, index) => ({
    source,
    itemId: source.id
      ? `${source.id}-${index}`
      : source.url
        ? `${source.url}-${index}`
        : `web-${index}`
  }))
  const used = indexedSources.filter(({ source }) => source.used !== false)
  const unused = indexedSources.filter(({ source }) => source.used === false)
  const total = sources.length

  // Lookup for per-item extras (publishedAt) the generic SourceItem can't hold.
  const byItemId = new Map(
    indexedSources.map(({ source, itemId }) => [itemId, source])
  )

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
      metadataPosition="before-title"
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
        const ws = byItemId.get(String(item.id))
        return (
          <span className="inline-flex max-w-full items-center gap-1.5">
            <a
              href={url}
              target="_blank"
              rel="noreferrer"
              title={url}
              // Stop the accordion trigger from toggling when opening the link.
              onClick={(e) => e.stopPropagation()}
              className="inline-flex min-w-0 items-center gap-1 text-primary underline-offset-2 hover:underline">
              <WebSourceFavicon url={url} />
              <span className="min-w-0 truncate">{host}</span>
            </a>
            <SearchEngineBadge engine={ws?.source} />
          </span>
        )
      }}
      renderContent={(item) => {
        // Keep expanded cards user-facing: no backend score or generic category
        // noise. Search-engine badges live beside the host in the collapsed row.
        const ws = byItemId.get(String(item.id))
        const details: string[] = []
        if (ws?.category && ws.category !== "general") details.push(ws.category)
        if (ws?.publishedAt)
          details.push(
            t("chat.sources.web_published", { date: ws.publishedAt })
          )
        return (
          <div className="space-y-2">
            {details.length > 0 && (
              <p className="text-[10px] text-muted-foreground/75">
                {details.join(" · ")}
              </p>
            )}
            <p className="whitespace-pre-wrap wrap-anywhere text-[11px] text-muted-foreground">
              {item.content || t("chat.sources.web_no_snippet")}
            </p>
          </div>
        )
      }}
    />
  )
}
