/**
 * Coarse browser/OS identification for support reports.
 *
 * Its own module because the background bundle needs exactly this and nothing
 * else from `error-report`. Importing it from there pulled the issue-draft
 * composition — templates, URL length budgeting, the privacy tail — into the
 * background chunk, which has a size budget and no use for any of it.
 */
type NavigatorWithBrands = Navigator & {
  brave?: unknown
  userAgentData?: {
    brands?: Array<{ brand: string; version: string }>
    platform?: string
  }
}

const majorVersion = (userAgent: string, pattern: RegExp): string | undefined =>
  userAgent.match(pattern)?.[1]

export const getSafeClientEnvironment = (): {
  browser: string
  os: string
} => {
  if (typeof navigator === "undefined") {
    return { browser: "unknown", os: "unknown" }
  }

  const nav = navigator as NavigatorWithBrands
  const userAgent = nav.userAgent || ""
  const brands = nav.userAgentData?.brands ?? []
  const chromiumVersion =
    brands.find(({ brand }) => /Chromium/i.test(brand))?.version ||
    majorVersion(userAgent, /(?:Chrome|CriOS)\/(\d+)/i)
  const isBrave =
    Boolean(nav.brave) || brands.some(({ brand }) => /Brave/i.test(brand))

  const browser = /Firefox\/(\d+)/i.test(userAgent)
    ? `Firefox ${majorVersion(userAgent, /Firefox\/(\d+)/i)}`
    : /Edg(?:e|A|iOS)?\/(\d+)/i.test(userAgent)
      ? `Edge ${majorVersion(userAgent, /Edg(?:e|A|iOS)?\/(\d+)/i)}`
      : /OPR\/(\d+)/i.test(userAgent)
        ? `Opera ${majorVersion(userAgent, /OPR\/(\d+)/i)}`
        : isBrave
          ? `Brave${chromiumVersion ? ` (Chromium ${chromiumVersion})` : ""}`
          : /(?:Chrome|CriOS)\/(\d+)/i.test(userAgent)
            ? `Chrome/Chromium ${majorVersion(userAgent, /(?:Chrome|CriOS)\/(\d+)/i)}`
            : /Version\/(\d+).+Safari\//i.test(userAgent)
              ? `Safari ${majorVersion(userAgent, /Version\/(\d+)/i)}`
              : "unknown"

  const platform = nav.userAgentData?.platform || nav.platform || ""
  const osSource = `${userAgent} ${platform}`
  const os = /Android/i.test(osSource)
    ? "Android"
    : /iPhone|iPad|iPod/i.test(osSource)
      ? "iOS/iPadOS"
      : /Windows/i.test(osSource)
        ? "Windows"
        : /CrOS/i.test(osSource)
          ? "ChromeOS"
          : /Mac OS|Macintosh|MacIntel/i.test(osSource)
            ? "macOS"
            : /Linux/i.test(osSource)
              ? "Linux"
              : "unknown"

  return { browser, os }
}
