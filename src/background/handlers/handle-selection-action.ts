import { buildSelectionActionPrompt } from "@/application/selection-actions/prompt-builder"
import type { SelectionActionMessage } from "@/application/selection-actions/types"
import { setAbortController } from "@/background/lib/abort-controller-registry"
import { normalizeError } from "@/background/lib/error-handler"
import { safePostChatStreamEvent } from "@/background/lib/runtime-delivery"
import { MESSAGE_KEYS } from "@/lib/constants"
import { logger } from "@/lib/logger"
import {
  getStoredModelConfig,
  resolveModelConfig
} from "@/lib/model-config-utils"
import { ProviderFactory } from "@/lib/providers/factory"
import { assertProviderEnabled } from "@/lib/providers/provider-policy"
import { readSetting } from "@/lib/storage/setting-access"
import { SETTINGS } from "@/lib/storage/settings"
import type { ChromePort, PortStatusFunction } from "@/types"

export const handleSelectionAction = async (
  msg: SelectionActionMessage,
  port: ChromePort,
  isPortClosed: PortStatusFunction
) => {
  const selectedRef = await readSetting(SETTINGS.SELECTED_MODEL_REF)
  const fallbackModel = await readSetting(SETTINGS.SELECTED_MODEL)

  const model =
    msg.payload.model || (selectedRef ? selectedRef.modelId : fallbackModel)
  const providerId =
    msg.payload.providerId || (selectedRef ? selectedRef.providerId : undefined)

  if (!model) {
    safePostChatStreamEvent(port, {
      version: 1,
      type: MESSAGE_KEYS.BROWSER.SELECTION_ACTION_ERROR,
      failure: {
        status: 400,
        message: "Select a model before running Selection Actions"
      }
    })
    return
  }

  const ac = new AbortController()
  // Scope key is per-connection; port.name is a shared constant that would
  // collide when two windows run selection actions concurrently.
  const abortKey = port.abortScopeKey ?? port.name
  setAbortController(abortKey, ac)

  try {
    const modelConfigMap = await readSetting(SETTINGS.MODEL_CONFIGS)
    const storedModelConfig = getStoredModelConfig(
      modelConfigMap,
      model,
      providerId
    )
    const modelParams = resolveModelConfig(storedModelConfig)
    const provider = await ProviderFactory.getProviderForModel(
      model,
      providerId
    )
    assertProviderEnabled(provider, model)
    // Use the user's explicitly configured system prompt, not the
    // default-merged one. DEFAULT_MODEL_CONFIG.system ("...format with
    // markdown...") conflicts with the selection action's "Return plain text
    // only" instruction, so only forward a system prompt the user actually set.
    const configuredSystemPrompt =
      storedModelConfig?.system?.trim() || undefined
    const prompt = buildSelectionActionPrompt(
      msg.payload,
      configuredSystemPrompt
    )

    await provider.streamChat(
      {
        model,
        messages: prompt.messages,
        temperature: modelParams.temperature,
        top_p: modelParams.top_p,
        top_k: modelParams.top_k,
        repeat_penalty: modelParams.repeat_penalty,
        repeat_last_n: modelParams.repeat_last_n,
        seed: modelParams.seed,
        num_ctx: modelParams.num_ctx,
        num_predict: modelParams.num_predict,
        min_p: modelParams.min_p,
        stop: modelParams.stop,
        num_thread: modelParams.num_thread,
        num_gpu: modelParams.num_gpu,
        num_batch: modelParams.num_batch,
        keep_alive: modelParams.keep_alive,
        reasoningEffort: modelParams.reasoning_effort
      },
      (chunk) => {
        if (isPortClosed()) return
        if (chunk.error) {
          safePostChatStreamEvent(port, {
            version: 1,
            type: MESSAGE_KEYS.BROWSER.SELECTION_ACTION_ERROR,
            failure: chunk.error
          })
          return
        }
        if (chunk.delta || chunk.thinkingDelta) {
          safePostChatStreamEvent(port, {
            version: 1,
            type: MESSAGE_KEYS.BROWSER.SELECTION_ACTION_CHUNK,
            payload: {
              delta: chunk.delta ?? "",
              thinkingDelta: chunk.thinkingDelta ?? ""
            }
          })
        }
        if (chunk.done) {
          safePostChatStreamEvent(port, {
            version: 1,
            type: MESSAGE_KEYS.BROWSER.SELECTION_ACTION_DONE
          })
        }
      },
      ac.signal
    )
  } catch (error) {
    logger.error("Selection action failed", "handleSelectionAction", { error })
    safePostChatStreamEvent(port, {
      version: 1,
      type: MESSAGE_KEYS.BROWSER.SELECTION_ACTION_ERROR,
      failure: normalizeError(error)
    })
  } finally {
    setAbortController(abortKey, null)
  }
}
