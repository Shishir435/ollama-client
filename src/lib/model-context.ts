import {
  AUTO_CONTEXT_CAP_TOKENS,
  PREVIOUS_DEFAULT_MODEL_CONTEXT_SIZE
} from "@/lib/constants"
import { customProviderWireFromId, ProviderId } from "@/lib/providers/types"

/** Whether a stored `num_ctx` is Auto: nothing the user set. */
export const isAutoContext = (numCtx: number | undefined): boolean =>
  typeof numCtx !== "number" || !Number.isFinite(numCtx) || numCtx <= 0

/**
 * Auto's ceiling for a provider. Ollama allocates memory for the window each
 * request names, so Auto stays small there; other runners size their window
 * at load time and keep the earlier default.
 */
export const autoContextCap = (providerId?: string): number =>
  !providerId ||
  providerId === ProviderId.OLLAMA ||
  customProviderWireFromId(providerId) === "ollama"
    ? AUTO_CONTEXT_CAP_TOKENS
    : PREVIOUS_DEFAULT_MODEL_CONTEXT_SIZE

/**
 * The window to ask a runner for.
 *
 * Auto asks for what the model reports, held to {@link AUTO_CONTEXT_CAP_TOKENS},
 * or to the cap alone when the model reports nothing. An explicit value is the
 * user's to make and is respected, but never past what the model says it can
 * hold: a window larger than the weights were trained for only costs memory.
 */
export const resolveEffectiveContext = ({
  configured,
  reported,
  cap = AUTO_CONTEXT_CAP_TOKENS
}: {
  configured?: number
  reported?: number
  cap?: number
}): number => {
  const known =
    typeof reported === "number" && Number.isFinite(reported) && reported > 0
      ? Math.floor(reported)
      : undefined
  if (!isAutoContext(configured)) {
    const explicit = Math.floor(configured as number)
    return known ? Math.min(explicit, known) : explicit
  }
  return known ? Math.min(known, cap) : cap
}

const POSITIVE_INTEGER = /^\d+$/

/**
 * The window the weights were trained for, from Ollama's `/api/show`
 * `model_info`. The key carries the architecture (`llama.context_length`), so
 * it is matched by suffix rather than by a list of architectures. A value that
 * is not a positive integer is no information, not a small window.
 */
export const reportedContextLengthFromModelInfo = (
  info: Record<string, unknown> | undefined | null
): number | undefined => {
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
