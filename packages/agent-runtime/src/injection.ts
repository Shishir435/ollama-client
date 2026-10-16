import type { AgentObservation } from "@ollama-client/contracts"

/**
 * Text written to steer an agent rather than to inform a reader: "ignore
 * previous instructions", a fake system turn, a note telling an assistant
 * what to do or what to keep from the user. A page that carries it is one
 * standing consent must stop trusting, whoever wrote it there.
 *
 * Deliberately crude. It is not a defence — page text never authorizes
 * anything here in the first place — only a reason to go back to asking. A
 * page about prompt injection reads as one, which costs that run its
 * shortcuts and nothing else; a phrasing it misses leaves every other
 * boundary where it was.
 */
const INJECTION_SHAPES: readonly RegExp[] = [
  /\b(?:ignore|disregard|forget|override)\b[^.\n]{0,40}\b(?:previous|prior|above|earlier|all|your)\b[^.\n]{0,20}\b(?:instructions?|prompts?|directions?|rules)\b/,
  /\b(?:new|updated|real|actual|hidden)\s+(?:system\s+)?instructions?\s*:/,
  /\bsystem\s+prompt\b/,
  /<\/?\s*(?:system|assistant|instructions?)\s*>/,
  /\b(?:ai|llm|assistant|agent|bot|model)s?\b[,:]?\s+(?:you\s+)?(?:must|should|need\s+to|are\s+(?:now\s+)?(?:required|instructed))\b/,
  /\b(?:do\s+not|don't|never)\s+(?:tell|inform|alert|notify|show)\s+(?:the\s+)?user\b/,
  /\bas\s+an?\s+(?:ai|assistant|agent)\b[^.\n]{0,30}\b(?:you|must|should)\b/
]

/** How much of a page the check reads; enough for any page an agent reads. */
const MAX_SCANNED_CHARS = 60_000

export const agentPageLooksInjected = (
  observation: Pick<AgentObservation, "visibleText" | "documentText">
): boolean => {
  const text = `${observation.visibleText}\n${observation.documentText ?? ""}`
    .slice(0, MAX_SCANNED_CHARS)
    .toLocaleLowerCase()
  return INJECTION_SHAPES.some((shape) => shape.test(text))
}
