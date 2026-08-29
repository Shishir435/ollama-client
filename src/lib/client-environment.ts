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

interface BrowserRule {
  pattern: RegExp
  label: string
  versionPattern?: RegExp
}

const BROWSER_RULES: BrowserRule[] = [
  {
    pattern: /Firefox\/(\d+)/i,
    label: "Firefox",
    versionPattern: /Firefox\/(\d+)/i
  },
  {
    pattern: /Edg(?:e|A|iOS)?\/(\d+)/i,
    label: "Edge",
    versionPattern: /Edg(?:e|A|iOS)?\/(\d+)/i
  },
  {
    pattern: /OPR\/(\d+)/i,
    label: "Opera",
    versionPattern: /OPR\/(\d+)/i
  },
  {
    pattern: /(?:Chrome|CriOS)\/(\d+)/i,
    label: "Chrome/Chromium",
    versionPattern: /(?:Chrome|CriOS)\/(\d+)/i
  },
  {
    pattern: /Version\/(\d+).+Safari\//i,
    label: "Safari",
    versionPattern: /Version\/(\d+)/i
  }
]

const detectBrowser = (nav: NavigatorWithBrands, userAgent: string): string => {
  const brands = nav.userAgentData?.brands ?? []
  const chromiumVersion =
    brands.find(({ brand }) => /Chromium/i.test(brand))?.version ||
    majorVersion(userAgent, /(?:Chrome|CriOS)\/(\d+)/i)
  const isBrave =
    Boolean(nav.brave) || brands.some(({ brand }) => /Brave/i.test(brand))

  if (isBrave) {
    return `Brave${chromiumVersion ? ` (Chromium ${chromiumVersion})` : ""}`
  }

  const rule = BROWSER_RULES.find(({ pattern }) => pattern.test(userAgent))
  if (!rule) return "unknown"
  const version = rule.versionPattern
    ? majorVersion(userAgent, rule.versionPattern)
    : undefined
  return version ? `${rule.label} ${version}` : rule.label
}

const OS_RULES: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /Android/i, label: "Android" },
  { pattern: /iPhone|iPad|iPod/i, label: "iOS/iPadOS" },
  { pattern: /Windows/i, label: "Windows" },
  { pattern: /CrOS/i, label: "ChromeOS" },
  { pattern: /Mac OS|Macintosh|MacIntel/i, label: "macOS" },
  { pattern: /Linux/i, label: "Linux" }
]

const detectOs = (source: string): string =>
  OS_RULES.find(({ pattern }) => pattern.test(source))?.label ?? "unknown"

export const getSafeClientEnvironment = (): {
  browser: string
  os: string
} => {
  if (typeof navigator === "undefined") {
    return { browser: "unknown", os: "unknown" }
  }

  const nav = navigator as NavigatorWithBrands
  const userAgent = nav.userAgent || ""
  const platform = nav.userAgentData?.platform || nav.platform || ""
  return {
    browser: detectBrowser(nav, userAgent),
    os: detectOs(`${userAgent} ${platform}`)
  }
}
