import type { MessageFailure } from "./turn-events.js"

/**
 * The `type` a failed turn carries when OpenCode's Zen gateway refused a
 * free-tier model. It travels on the wire so the core can answer with the
 * upstream's own 403 instead of a generic 502.
 */
export const FREE_TIER_REFUSAL_TYPE = "FreeTierError"

/**
 * Whether an assistant failure is Zen's free-tier gate.
 *
 * Matched two ways because the shape varies by OpenCode release: the
 * gateway's own `FreeTierError` code inside the provider response body when
 * it is present, and the refusal sentence otherwise. Both are OpenCode's own
 * words, never page content, so repeating them cannot leak anything the page
 * chose.
 */
export const isFreeTierRefusal = (failure: MessageFailure): boolean => {
  const body = failure.data?.responseBody
  const texts = [
    typeof body === "string" ? body : JSON.stringify(body ?? null),
    failure.data?.message ?? "",
    failure.message ?? ""
  ]
  return texts.some(
    (text) =>
      text.includes("FreeTierError") ||
      /free tier can only be used from within OpenCode/i.test(text)
  )
}

/**
 * What the client is told. Names the model it asked for (its own string, not
 * page content) and the two paths that actually work, because "check that the
 * backend is running" sends the user to debug a process that is working.
 */
export const freeTierRefusalMessage = (model: string): string =>
  `Model "${model}" refused this request: OpenCode's free tier can only be used from within OpenCode's own clients. Through this proxy, use a model from a key-backed provider, or run this model in OpenCode's TUI or Desktop app.`
