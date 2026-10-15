import { runtime } from "@/lib/browser-api"

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

export const hostOf = (url?: string): string | undefined => {
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

export function SearchEngineBadge({ engine }: { engine?: string }) {
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
