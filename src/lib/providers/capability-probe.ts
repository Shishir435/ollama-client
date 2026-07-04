import { STORAGE_KEYS } from "@/lib/constants"
import { logger } from "@/lib/logger"
import {
  getPlasmoStoredValue,
  setPlasmoStoredValue
} from "@/lib/plasmo-global-storage"
import type { LLMProvider } from "./types"

/**
 * Empirical capability probing: send one trivial tool-call request and see
 * whether the model actually emits a native tool call. This is how models on
 * providers with no capability metadata (everything OpenAI-compatible) get
 * `toolCalling` detected without the user hand-toggling an override.
 *
 * Probes run only on explicit user action (a "Detect" button) — never as a
 * background scan. Local servers load models on request, so probing a model
 * list would thrash VRAM.
 *
 * Results are stored per `providerId::model`, device-local (the base URL —
 * and therefore the answering server — differs per device), and are dropped
 * when the provider's base URL changes.
 */

export interface CapabilityProbeResult {
  /** Set when a tool-calling probe has run. Absent means "not yet probed". */
  toolCalling?: boolean
  /** Set when a reasoning/thinking probe has run. Absent means "not yet probed". */
  reasoning?: boolean
  /** Set when a vision probe reached a verdict. Absent means "inconclusive". */
  vision?: boolean
  probedAt: number
}

export type CapabilityProbeMap = Record<string, CapabilityProbeResult>

const STORAGE_KEY = STORAGE_KEYS.PROVIDER.MODEL_CAPABILITY_PROBES

const PROBE_TIMEOUT_MS = 30_000

/**
 * Serializes read-modify-write operations on the probe map. Each write reads the
 * whole map, patches one key, and writes it back; without serialization two
 * writes racing (e.g. the side panel and options page probing different models
 * at once) would both read the same stale map and the later write would drop the
 * other's result. Chaining writes here guarantees each observes the previous one.
 *
 * Guards writes within a single extension context only — a concurrent write from
 * another context can still race, an accepted limitation for this low-frequency,
 * user-driven action. Mirrors `model-capability-overrides.ts`.
 */
let writeQueue: Promise<unknown> = Promise.resolve()

const enqueueWrite = <T>(operation: () => Promise<T>): Promise<T> => {
  const result = writeQueue.then(operation, operation)
  writeQueue = result.then(
    () => undefined,
    () => undefined
  )
  return result
}

export const capabilityProbeKey = (
  providerId: string,
  modelName: string
): string => `${providerId}::${modelName}`

export const getAllCapabilityProbes = async (): Promise<CapabilityProbeMap> => {
  const stored = await getPlasmoStoredValue<CapabilityProbeMap>(STORAGE_KEY)
  return stored ?? {}
}

export const getCapabilityProbe = async (
  providerId: string,
  modelName: string
): Promise<CapabilityProbeResult | null> => {
  const all = await getAllCapabilityProbes()
  return all[capabilityProbeKey(providerId, modelName)] ?? null
}

/**
 * Merge a probe result into the stored entry. Merging (not replacing) lets the
 * tool-calling and reasoning probes accumulate independently — probing one never
 * erases a previously-probed other.
 */
export const setCapabilityProbe = (
  providerId: string,
  modelName: string,
  result: CapabilityProbeResult
): Promise<void> =>
  enqueueWrite(async () => {
    const all = await getAllCapabilityProbes()
    const key = capabilityProbeKey(providerId, modelName)
    all[key] = { ...all[key], ...result }
    await setPlasmoStoredValue(STORAGE_KEY, all)
  })

export const clearCapabilityProbe = (
  providerId: string,
  modelName: string
): Promise<void> =>
  enqueueWrite(async () => {
    const all = await getAllCapabilityProbes()
    const key = capabilityProbeKey(providerId, modelName)
    if (key in all) {
      delete all[key]
      await setPlasmoStoredValue(STORAGE_KEY, all)
    }
  })

/**
 * Drop every probe result for a provider. Called when its base URL changes —
 * a different server may sit behind the same provider entry.
 */
export const clearCapabilityProbesForProvider = (
  providerId: string
): Promise<void> =>
  enqueueWrite(async () => {
    const all = await getAllCapabilityProbes()
    const prefix = `${providerId}::`
    let changed = false
    for (const key of Object.keys(all)) {
      if (key.startsWith(prefix)) {
        delete all[key]
        changed = true
      }
    }
    if (changed) await setPlasmoStoredValue(STORAGE_KEY, all)
  })

/** The trivial tool offered during a probe. */
const PROBE_TOOL = {
  name: "ping",
  description:
    "Test tool. When asked to verify tool support, call this with value set to 'pong'.",
  parameters: {
    type: "object" as const,
    properties: {
      value: { type: "string", description: "Echo value" }
    },
    required: ["value"]
  }
}

/**
 * Send one minimal tool-call request and report whether the model natively
 * called the tool. `false` means "did not call" — which can be a model
 * limitation or a server that ignores the `tools` field; either way native
 * tool-calling is not usable for this model as served today.
 */
export const probeToolCalling = async (
  provider: LLMProvider,
  modelName: string
): Promise<CapabilityProbeResult> => {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS)

  let sawToolCall = false
  let streamError: string | undefined
  try {
    await provider.streamChat(
      {
        model: modelName,
        messages: [
          {
            role: "user",
            content:
              "Call the ping tool with value 'pong' to verify tool support. Do not answer in text."
          }
        ],
        tools: [PROBE_TOOL],
        think: false,
        num_predict: 256
      },
      (chunk) => {
        if (chunk.error) {
          streamError = chunk.error.message || "Probe request failed"
        }
        if (chunk.toolCalls && chunk.toolCalls.length > 0) {
          sawToolCall = true
          // The answer is in — cut the stream instead of letting the model run.
          controller.abort()
        }
      },
      controller.signal
    )
  } catch (error) {
    // Abort-after-success is expected; anything else only matters if we never
    // saw a tool call (the caller still records toolCalling: false).
    if (!sawToolCall) {
      logger.debug("Tool-calling probe request failed", "capabilityProbe", {
        model: modelName,
        error
      })
      throw error
    }
  } finally {
    clearTimeout(timeout)
  }

  // A failed request proves nothing about the model — surface it instead of
  // recording a misleading `toolCalling: false`.
  if (!sawToolCall && streamError) {
    throw new Error(streamError)
  }

  return { toolCalling: sawToolCall, probedAt: Date.now() }
}

/** Matches the error Ollama returns when `think` is sent to a non-thinking model. */
const THINKING_UNSUPPORTED = /does not support think/i

/**
 * Send one minimal `think: true` request and report whether the model emitted a
 * separate reasoning stream. A thinking delta is a positive signal; a clean
 * finish with no delta is recorded as `false` (mirrors the tool probe — a
 * trivial prompt not triggering reasoning is treated as "not usable as served").
 * A server that rejects `think` outright ("does not support thinking") is also a
 * clean `false`; any other stream error is surfaced rather than recorded.
 */
export const probeReasoning = async (
  provider: LLMProvider,
  modelName: string
): Promise<CapabilityProbeResult> => {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS)

  let sawThinking = false
  let streamError: string | undefined
  try {
    await provider.streamChat(
      {
        model: modelName,
        messages: [
          {
            role: "user",
            content:
              "Think briefly before answering, then answer: what is 2 + 2?"
          }
        ],
        think: true,
        num_predict: 256
      },
      (chunk) => {
        if (chunk.error) {
          streamError = chunk.error.message || "Probe request failed"
        }
        if (chunk.thinkingDelta && chunk.thinkingDelta.length > 0) {
          sawThinking = true
          // Signal is in — cut the stream instead of paying for the full answer.
          controller.abort()
        }
      },
      controller.signal
    )
  } catch (error) {
    if (!sawThinking) {
      logger.debug("Reasoning probe request failed", "capabilityProbe", {
        model: modelName,
        error
      })
      const message = error instanceof Error ? error.message : ""
      // "does not support thinking" is a definitive negative, not a failure.
      if (THINKING_UNSUPPORTED.test(message)) {
        return { reasoning: false, probedAt: Date.now() }
      }
      throw error
    }
  } finally {
    clearTimeout(timeout)
  }

  if (!sawThinking && streamError) {
    if (THINKING_UNSUPPORTED.test(streamError)) {
      return { reasoning: false, probedAt: Date.now() }
    }
    throw new Error(streamError)
  }

  return { reasoning: sawThinking, probedAt: Date.now() }
}

/**
 * A 48×48 solid-red PNG (raw base64, no data prefix). Distinct, unambiguous
 * content: a model that can actually read the pixels reports "red"; a text-only
 * model given the same bytes cannot.
 */
const PROBE_IMAGE_RED_PNG =
  "iVBORw0KGgoAAAANSUhEUgAAADAAAAAwCAIAAADYYG7QAAAAOklEQVR42u3OMQ0AAAgDsImYf2WIwQXhaFIBzbSvREhISEhISEhISEhISEhISEhISEhISEhISEjozgLL0SSIMo/dHQAAAABJRU5ErkJggg=="

/** Matches errors a server returns when a model can't accept image input. */
const IMAGE_UNSUPPORTED = /image|vision|multimodal|missing data/i

/**
 * Send one image (a solid-red square) and ask for the dominant color. This probe
 * is deliberately **positive-only**: a correct "red" answer proves the model read
 * the pixels (`vision: true`); anything else is left *inconclusive* (no verdict
 * recorded) so a model that phrases the color differently never overrides correct
 * metadata. The one clean negative is a server that rejects image input outright.
 */
export const probeVision = async (
  provider: LLMProvider,
  modelName: string
): Promise<CapabilityProbeResult> => {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS)

  let answer = ""
  let streamError: string | undefined
  try {
    await provider.streamChat(
      {
        model: modelName,
        messages: [
          {
            role: "user",
            content:
              "What is the dominant color of this image? Reply with only the color word.",
            images: [
              {
                imageId: "capability-probe",
                fileName: "probe.png",
                mimeType: "image/png",
                size: 0,
                base64: PROBE_IMAGE_RED_PNG
              }
            ]
          }
        ],
        think: false,
        num_predict: 16
      },
      (chunk) => {
        if (chunk.error) {
          streamError = chunk.error.message || "Probe request failed"
        }
        if (chunk.delta) answer += chunk.delta
        if (chunk.content) answer += chunk.content
      },
      controller.signal
    )
  } catch (error) {
    logger.debug("Vision probe request failed", "capabilityProbe", {
      model: modelName,
      error
    })
    const message = error instanceof Error ? error.message : ""
    if (IMAGE_UNSUPPORTED.test(message)) {
      return { vision: false, probedAt: Date.now() }
    }
    throw error
  } finally {
    clearTimeout(timeout)
  }

  // A server that flat-out rejects image input is a clean negative.
  if (streamError) {
    if (IMAGE_UNSUPPORTED.test(streamError)) {
      return { vision: false, probedAt: Date.now() }
    }
    throw new Error(streamError)
  }

  // Positive only: record `true` on a correct read; otherwise stay silent so the
  // resolver falls back to metadata rather than a possibly-wrong `false`.
  if (/red/i.test(answer)) {
    return { vision: true, probedAt: Date.now() }
  }
  return { probedAt: Date.now() }
}
