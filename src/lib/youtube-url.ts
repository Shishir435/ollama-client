const youtubeHost = (hostname: string) =>
  hostname === "youtube.com" || hostname.endsWith(".youtube.com")

export const getYouTubeVideoId = (url: string): string => {
  try {
    const parsed = new URL(url)
    if (!youtubeHost(parsed.hostname)) return ""

    if (parsed.pathname === "/watch") {
      return parsed.searchParams.get("v") || ""
    }

    const pathMatch = parsed.pathname.match(/^\/(?:live|shorts)\/([^/]+)/)
    return pathMatch?.[1] ? decodeURIComponent(pathMatch[1]) : ""
  } catch {
    return ""
  }
}

export const isYouTubeVideoPage = (url: string): boolean =>
  Boolean(getYouTubeVideoId(url))
