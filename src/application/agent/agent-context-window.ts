import { readSetting } from "@/lib/storage/setting-access"
import { SETTINGS } from "@/lib/storage/settings"
import type { ProviderModelDetails } from "@/types"

/**
 * The window one run decides in, resolved from the model rather than written
 * beside it.
 *
 * Four quantities were conflated by the two literals this replaces: what the
 * catalog advertises, what the server has actually allocated, what the answer
 * is allowed to cost, and what we choose to spend. Only the last is ours. A
 * training or catalog maximum is upper-bound evidence, not proof that this
 * Ollama instance allocated it or that this machine has the memory, so the
 * resolution takes the **smallest** thing it is told rather than the largest,
 * and falls back to a conservative figure when it is told nothing.
 *
 * The cost of getting it wrong runs both ways, which is why a single literal
 * could not be right. Too large and a small local model is asked for memory it
 * does not have, or silently truncates; too small and a hosted model with a
 * 200k window has its page content trimmed to fit a bound that describes
 * nothing about it — which is what pinned one measured run's prompt at 15,213
 * tokens against a 16,384 clamp.
 */

/**
 * Below this the fixed prompt — instructions, tool schema, an answer — does not
 * fit, so a smaller number would not be a smaller window but a broken one.
 */
export const AGENT_CONTEXT_MIN_TOKENS = 8_192

/**
 * What `auto` will reach on its own. A model that reports more is believed
 * about its own capacity and still held here, because the memory is this
 * machine's to spend and nothing in the catalog knows how much there is. A
 * user who wants a hosted model's whole window sets an explicit number.
 */
export const AGENT_CONTEXT_AUTO_MAX_TOKENS = 32_768

/** The most an explicit setting may ask for, whatever the model claims. */
export const AGENT_CONTEXT_MAX_TOKENS = 131_072

/**
 * Used when nothing is known. Deliberately not the auto maximum: an unknown
 * window is not evidence of a large one, and the failure it guards against —
 * asking a small model for four times what it has — is the more expensive of
 * the two.
 */
export const AGENT_CONTEXT_FALLBACK_TOKENS = 16_384

export type AgentContextWindowSetting = "auto" | number

export interface AgentContextWindowEvidence {
  /** What the provider's catalog advertises for this model, if anything. */
  catalogContextLength?: number
  /**
   * What the server says it has actually allocated. Ollama's `/api/show`
   * returns the Modelfile's parameters verbatim, and a `num_ctx` in them is
   * the strongest evidence available: not what the weights permit, but what
   * this instance will really give us.
   */
  details?: ProviderModelDetails | null
}

export interface AgentContextWindow {
  tokens: number
  /**
   * Where the figure came from, for the diagnostic and for the settings row
   * that shows the user what `auto` resolved to. Never used to make a
   * decision — the number is the decision.
   */
  source: "user" | "allocated" | "metadata" | "catalog" | "fallback"
}

const POSITIVE_INTEGER = /^\d+$/

/**
 * `num_ctx` as the Modelfile states it. The parameters block is newline
 * separated `name value` pairs with arbitrary whitespace, and a model may
 * state it more than once; the last one wins, as it does in a Modelfile.
 */
const allocatedContextLength = (
  details: ProviderModelDetails | null | undefined
): number | undefined => {
  const parameters = details?.parameters
  if (typeof parameters !== "string") return undefined
  let found: number | undefined
  for (const line of parameters.split("\n")) {
    const match = /^\s*num_ctx\s+(\d+)\s*$/.exec(line)
    if (match) found = Number(match[1])
  }
  return found && found > 0 ? found : undefined
}

/**
 * The window the weights were trained for, from Ollama's `model_info`.
 *
 * The key is architecture-prefixed — `llama.context_length`,
 * `qwen3.context_length` — so it is matched by suffix rather than by a table
 * of architectures nobody can keep current. Anything that is not a positive
 * integer is ignored rather than coerced: a malformed value here is not a
 * small window, it is no information.
 */
const metadataContextLength = (
  details: ProviderModelDetails | null | undefined
): number | undefined => {
  const info = details?.model_info
  if (!info) return undefined
  for (const [key, value] of Object.entries(info)) {
    if (!key.endsWith(".context_length") && key !== "context_length") continue
    if (typeof value === "number" && Number.isInteger(value) && value > 0) {
      return value
    }
    if (typeof value === "string" && POSITIVE_INTEGER.test(value)) {
      const parsed = Number(value)
      if (parsed > 0) return parsed
    }
  }
  return undefined
}

const clamp = (tokens: number, ceiling: number): number =>
  Math.max(AGENT_CONTEXT_MIN_TOKENS, Math.min(ceiling, Math.floor(tokens)))

/**
 * An explicit setting is honoured as stated, held only inside the bounds that
 * make a window a window at all.
 *
 * It deliberately overrides the model's own report in both directions. A user
 * who has raised their server's `num_ctx` knows something the catalog does
 * not, and one who has hit an out-of-memory failure knows something the
 * metadata does not. What it cannot do is ask for less than the fixed prompt
 * or more than the hard maximum.
 */
export const resolveAgentContextWindow = (input: {
  setting?: AgentContextWindowSetting
  evidence?: AgentContextWindowEvidence
}): AgentContextWindow => {
  const setting = input.setting ?? "auto"
  if (typeof setting === "number" && Number.isFinite(setting) && setting > 0) {
    return { tokens: clamp(setting, AGENT_CONTEXT_MAX_TOKENS), source: "user" }
  }
  const evidence = input.evidence ?? {}
  const allocated = allocatedContextLength(evidence.details)
  const metadata = metadataContextLength(evidence.details)
  const catalog =
    evidence.catalogContextLength && evidence.catalogContextLength > 0
      ? evidence.catalogContextLength
      : undefined
  /**
   * The smallest thing we were told, not the largest. Each source answers a
   * different question — what this server allocated, what the weights allow,
   * what the catalog advertises — and the run has to fit inside all of the
   * answers it got, not the most generous one.
   */
  const known = [allocated, metadata, catalog].filter(
    (value): value is number => value !== undefined
  )
  if (known.length === 0) {
    return {
      tokens: clamp(
        AGENT_CONTEXT_FALLBACK_TOKENS,
        AGENT_CONTEXT_AUTO_MAX_TOKENS
      ),
      source: "fallback"
    }
  }
  const smallest = Math.min(...known)
  const source =
    allocated === smallest
      ? "allocated"
      : metadata === smallest
        ? "metadata"
        : "catalog"
  return {
    tokens: clamp(smallest, AGENT_CONTEXT_AUTO_MAX_TOKENS),
    source
  }
}

/**
 * The user's own answer, read where the run is driven rather than passed down
 * from a page: the background owns the run, and a value the side panel handed
 * it would be a value a page could influence.
 */
export const readAgentContextWindowSetting =
  async (): Promise<AgentContextWindowSetting> => {
    try {
      return await readSetting(SETTINGS.AGENT_CONTEXT_WINDOW)
    } catch {
      /* An unreadable setting is not a reason to refuse to decide. */
      return "auto"
    }
  }

/** How a run decides whether to picture the page, read the same way. */
export const readAgentVisionSetting = async (): Promise<
  "auto" | "always" | "never"
> => {
  try {
    return await readSetting(SETTINGS.AGENT_VISION)
  } catch {
    /* An unreadable preference falls back to the cheaper of the two. */
    return "auto"
  }
}
