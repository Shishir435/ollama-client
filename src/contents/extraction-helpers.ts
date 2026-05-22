import { normalizeWhitespaceForLLM } from "@/lib/text-utils"

export type SiteProfile =
  | "docs"
  | "blog"
  | "news"
  | "forum"
  | "video"
  | "general"

export interface ReliabilitySignals {
  contentDensity: number
  boilerplateRatio: number
  noiseRatio: number
}

export interface ReliabilityMeasurement {
  reliabilityScore: number
  reliabilitySignals: ReliabilitySignals
}

export const htmlToPlainText = (html: string): string => {
  const container = document.createElement("div")
  container.innerHTML = html
  return normalizeWhitespaceForLLM(container.textContent || "")
}

export const stripHtmlIfNeeded = (content: string): string => {
  const looksLikeHtml = /<\/?[a-z][\s\S]*>/i.test(content)
  if (!looksLikeHtml) return content
  return htmlToPlainText(content)
}

export const quickHash = (value: string): string => {
  let hash = 0
  for (let i = 0; i < value.length; i++) {
    hash = (hash << 5) - hash + value.charCodeAt(i)
    hash |= 0
  }
  return `${hash >>> 0}`
}

export const detectSiteProfile = (url: string): SiteProfile => {
  const lower = url.toLowerCase()
  if (lower.includes("youtube.com") || lower.includes("vimeo.com")) {
    return "video"
  }
  if (
    lower.includes("/docs") ||
    lower.includes("readthedocs") ||
    lower.includes("developer.")
  ) {
    return "docs"
  }
  if (
    lower.includes("/blog") ||
    lower.includes("medium.com") ||
    lower.includes("substack.com")
  ) {
    return "blog"
  }
  if (
    lower.includes("news") ||
    lower.includes("nytimes.com") ||
    lower.includes("theguardian.com")
  ) {
    return "news"
  }
  if (
    lower.includes("reddit.com") ||
    lower.includes("discuss") ||
    lower.includes("forum")
  ) {
    return "forum"
  }
  return "general"
}

export const measureReliability = (content: string): ReliabilityMeasurement => {
  const totalChars = Math.max(content.length, 1)
  const words = content.split(/\s+/).filter(Boolean)
  const wordChars = words.reduce((sum, word) => sum + word.length, 0)
  const contentDensity = Math.min(wordChars / totalChars, 1)

  const boilerplateMatches = content.match(
    /\b(cookie|privacy|terms|sign in|subscribe|advertisement|all rights reserved)\b/gi
  )
  const boilerplateRatio = Math.min(
    (boilerplateMatches?.length || 0) / Math.max(words.length, 1),
    1
  )

  const noisyChars = (content.match(/[#<>{}\\|=*]{2,}/g) || []).join("").length
  const noiseRatio = Math.min(noisyChars / totalChars, 1)

  const reliabilityScore = Math.max(
    0,
    Math.min(
      1,
      contentDensity * 0.7 +
        (1 - boilerplateRatio) * 0.2 +
        (1 - noiseRatio) * 0.1
    )
  )

  return {
    reliabilityScore,
    reliabilitySignals: {
      contentDensity: Number(contentDensity.toFixed(3)),
      boilerplateRatio: Number(boilerplateRatio.toFixed(3)),
      noiseRatio: Number(noiseRatio.toFixed(3))
    }
  }
}
