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
  toolCalling: boolean
  probedAt: number
}

export type CapabilityProbeMap = Record<string, CapabilityProbeResult>

const STORAGE_KEY = STORAGE_KEYS.PROVIDER.MODEL_CAPABILITY_PROBES

const PROBE_TIMEOUT_MS = 30_000

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

export const setCapabilityProbe = async (
  providerId: string,
  modelName: string,
  result: CapabilityProbeResult
): Promise<void> => {
  const all = await getAllCapabilityProbes()
  all[capabilityProbeKey(providerId, modelName)] = result
  await setPlasmoStoredValue(STORAGE_KEY, all)
}

export const clearCapabilityProbe = async (
  providerId: string,
  modelName: string
): Promise<void> => {
  const all = await getAllCapabilityProbes()
  const key = capabilityProbeKey(providerId, modelName)
  if (key in all) {
    delete all[key]
    await setPlasmoStoredValue(STORAGE_KEY, all)
  }
}

/**
 * Drop every probe result for a provider. Called when its base URL changes —
 * a different server may sit behind the same provider entry.
 */
export const clearCapabilityProbesForProvider = async (
  providerId: string
): Promise<void> => {
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
}

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
