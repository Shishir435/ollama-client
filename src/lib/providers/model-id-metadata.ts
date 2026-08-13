/**
 * Metadata recovered from a model id, for servers whose catalog omits it.
 *
 * LM Studio's `/api/v0/models` reports `arch`, `quantization`,
 * `max_context_length`, `capabilities`, and `type` — and no size of any kind.
 * There is no parameter count and no file size, on the list route or the
 * per-model route, and `/v1/models` returns only `id`/`object`/`owned_by`. So a
 * parameter badge for those models can only come from the id, which by
 * convention carries it: `google/gemma-4-12b`, `qwen/qwen3-4b-thinking-2507`.
 *
 * That is a naming convention, not an API contract, so the parser is
 * deliberately narrow and refuses to guess.
 */

/**
 * A whole token that is a number followed by "b": "12b", "0.6b", "8b".
 * Requiring the token to *be* this — not merely contain it — is what keeps
 * "4k" (a context window) and "2507" (a date) out.
 */
const PARAMETER_TOKEN = /^(\d+(?:\.\d+)?)b$/

/**
 * Reads a parameter count out of a model id, or returns "" when the id does not
 * state one unambiguously.
 *
 * Splits on everything except letters, digits, and dots — dots stay so
 * "qwen3-embedding-0.6b" yields "0.6b" rather than a "6b" that is off by a
 * factor of ten.
 *
 * Refuses rather than guesses when:
 * - no token qualifies ("phi-3.5-mini-4k-instruct" — "4k" is a context window)
 * - several disagree ("some-1b-8b-merge"), since picking one would be arbitrary
 * - the notation encodes something other than a plain total, as in the "8x7b"
 *   of a mixture-of-experts id, where the parameter count is neither 8 nor 7
 */
export const parameterSizeFromModelId = (modelId: string): string => {
  const matches = new Set<string>()
  for (const token of modelId.toLowerCase().split(/[^a-z0-9.]+/)) {
    const match = PARAMETER_TOKEN.exec(token)
    if (match) matches.add(match[1])
  }
  if (matches.size !== 1) return ""
  return `${[...matches][0]}B`
}
