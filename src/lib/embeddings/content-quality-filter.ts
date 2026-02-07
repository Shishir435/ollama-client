/**
 * Content Quality Assessment for RAG Embeddings
 *
 * Filters low-quality content before embedding to reduce noise
 * Uses heuristic signals to score content relevance and information density
 */

export interface ContentQualityScore {
  shouldEmbed: boolean
  score: number // 0-1 (higher = better quality)
  reasons: string[]
}

/**
 * Assess whether content is worth embedding for RAG
 *
 * @param text - Content to assess
 * @param role - Message role (user/assistant/system)
 * @param threshold - Minimum score to embed (default: 0.4)
 * @returns Quality assessment with score and reasoning
 */
export function assessContentQuality(
  text: string,
  role: string,
  threshold: number = 0.4
): ContentQualityScore {
  const signals = {
    // Positive signals (information-dense content)
    hasCodeBlock: /```[\s\S]*?```/.test(text),
    hasInlineCode: /`[^`]+`/.test(text),
    hasMarkdownHeaders: /^#{1,6}\s+.+$/m.test(text),
    hasMarkdownLists: /^[-*+]\s+.+$/m.test(text),
    hasUrls: /https?:\/\/[^\s]+/.test(text),
    hasTechnicalTerms:
      /\b(function|class|API|error|exception|algorithm|database|server|client|request|response|auth|binary|tree|graph|search|python|javascript|typescript|react|node|css|html|linux|terminal|command|install|config)\b/i.test(
        text
      ),
    isSubstantial: text.length > 50,
    hasMultipleLines: text.split("\n").filter((l) => l.trim()).length > 2,
    hasCompleteThoughts:
      text.split(/[.!?]+/).filter((s) => s.trim().length > 20).length >= 2,

    // Negative signals (noise/casual content)
    isGreeting:
      /^(hi|hello|hey|thanks|thank you|ok|okay|sure|yes|no|got it|i see|understood|alright|hi there|hello there)\.?$/i.test(
        text.trim()
      ),
    isVeryShort: text.length < 20,
    isOnlyQuestion:
      text.trim().endsWith("?") &&
      text.length < 40 &&
      !/\b(how|what|why|when|where|who)\b/i.test(text),
    hasOnlyPunctuation: /^[\s\p{P}]+$/u.test(text),
    isOnlyEmoji: /^[\s\p{Emoji_Presentation}\p{Extended_Pictographic}]+$/u.test(
      text
    ),
    isAffirmation:
      /^(ok|okay|thanks|thank you|sure|yes|got it|i see|understood|alright|noted)$/i.test(
        text.trim()
      )
  }

  // Start with baseline score
  let score = 0.5
  const reasons: string[] = []

  // Apply positive weights
  if (signals.hasCodeBlock) {
    score += 0.25
    reasons.push("contains code block")
  }
  if (signals.hasInlineCode) {
    score += 0.1
    reasons.push("contains inline code")
  }
  if (signals.hasMarkdownHeaders) {
    score += 0.1
    reasons.push("well-structured (headers)")
  }
  if (signals.hasMarkdownLists) {
    score += 0.08
    reasons.push("contains lists")
  }
  if (signals.hasTechnicalTerms) {
    score += 0.15
    reasons.push("technical content")
  }
  if (signals.hasCompleteThoughts) {
    score += 0.12
    reasons.push("complete thoughts")
  }
  if (signals.hasUrls) {
    score += 0.05
    reasons.push("contains references")
  }
  if (signals.isSubstantial && signals.hasMultipleLines) {
    score += 0.1
    reasons.push("substantial content")
  }

  // Apply negative weights
  if (signals.isGreeting) {
    score -= 0.5
    reasons.push("casual greeting")
  }
  if (signals.isAffirmation) {
    score -= 0.4
    reasons.push("simple affirmation")
  }
  if (signals.isVeryShort) {
    score -= 0.2
    reasons.push("too short")
  }
  if (signals.isOnlyQuestion && !signals.hasTechnicalTerms) {
    score -= 0.15
    reasons.push("simple question")
  }
  if (signals.hasOnlyPunctuation || signals.isOnlyEmoji) {
    score -= 0.5
    reasons.push("no meaningful text")
  }

  // Role-specific adjustments
  if (role === "system") {
    score += 0.2 // System messages often have important context
    reasons.push("system message")
  }

  if (role === "user" && signals.isOnlyQuestion && signals.isVeryShort) {
    score -= 0.1
    reasons.push("short user question")
  }

  if (role === "assistant") {
    // Assistant responses are generally more valuable
    if (text.length > 100) {
      score += 0.1
      reasons.push("detailed response")
    }
  }

  // Clamp score to [0, 1]
  score = Math.max(0, Math.min(1, score))

  return {
    shouldEmbed: score >= threshold,
    score,
    reasons
  }
}

/**
 * Batch assess multiple pieces of content
 */
export function assessContentQualityBatch(
  contents: Array<{ text: string; role: string }>,
  threshold: number = 0.4
): ContentQualityScore[] {
  return contents.map(({ text, role }) =>
    assessContentQuality(text, role, threshold)
  )
}

/**
 * Get recommended threshold based on storage constraints
 */
export function getRecommendedThreshold(
  currentVectorCount: number,
  maxVectors: number
): number {
  const utilizationRatio = currentVectorCount / maxVectors

  // As storage fills up, raise the bar
  if (utilizationRatio > 0.9) return 0.6 // Very selective
  if (utilizationRatio > 0.7) return 0.5 // Moderately selective
  if (utilizationRatio > 0.5) return 0.4 // Standard
  return 0.3 // Permissive when storage is plentiful
}
