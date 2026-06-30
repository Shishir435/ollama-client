import { setAbortController } from "@/background/lib/abort-controller-registry"
import { safePostMessage } from "@/background/lib/utils"
import { buildSelectionActionPrompt } from "@/features/selection-actions/prompt-builder"
import type { SelectionActionMessage } from "@/features/selection-actions/types"
import { MESSAGE_KEYS, STORAGE_KEYS } from "@/lib/constants"
import { getErrorMessage } from "@/lib/error-utils"
import { logger } from "@/lib/logger"
import { resolveModelConfig } from "@/lib/model-config-utils"
import { plasmoGlobalStorage } from "@/lib/plasmo-global-storage"
import { ProviderFactory } from "@/lib/providers/factory"
import { isSelectedModelRef } from "@/lib/providers/selected-model"
import type { ChromePort, ModelConfigMap, PortStatusFunction } from "@/types"

export const handleSelectionAction = async (
  msg: SelectionActionMessage,
  port: ChromePort,
  isPortClosed: PortStatusFunction
) => {
  const selectedRef = await plasmoGlobalStorage.get<unknown>(
    STORAGE_KEYS.PROVIDER.SELECTED_MODEL_REF
  )
  const fallbackModel = await plasmoGlobalStorage.get<string>(
    STORAGE_KEYS.PROVIDER.SELECTED_MODEL
  )

  const model =
    msg.payload.model ||
    (isSelectedModelRef(selectedRef) ? selectedRef.modelId : fallbackModel)
  const providerId =
    msg.payload.providerId ||
    (isSelectedModelRef(selectedRef) ? selectedRef.providerId : undefined)

  if (!model) {
    safePostMessage(port, {
      type: MESSAGE_KEYS.BROWSER.SELECTION_ACTION_ERROR,
      error: {
        status: 400,
        message: "Select a model before running Selection Actions"
      }
    })
    return
  }

  const ac = new AbortController()
  setAbortController(port.name, ac)

  try {
    const modelConfigMap =
      (await plasmoGlobalStorage.get<ModelConfigMap>(
        STORAGE_KEYS.PROVIDER.MODEL_CONFIGS
      )) ?? {}
    const modelParams = resolveModelConfig(modelConfigMap[model])
    const provider = await ProviderFactory.getProviderForModel(
      model,
      providerId
    )
    // Use the user's explicitly configured system prompt, not the
    // default-merged one. DEFAULT_MODEL_CONFIG.system ("...format with
    // markdown...") conflicts with the selection action's "Return plain text
    // only" instruction, so only forward a system prompt the user actually set.
    const configuredSystemPrompt =
      modelConfigMap[model]?.system?.trim() || undefined
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
        keep_alive: modelParams.keep_alive
      },
      (chunk) => {
        if (isPortClosed()) return
        if (chunk.error) {
          safePostMessage(port, {
            type: MESSAGE_KEYS.BROWSER.SELECTION_ACTION_ERROR,
            error: chunk.error
          })
          return
        }
        if (chunk.delta || chunk.thinkingDelta) {
          safePostMessage(port, {
            type: MESSAGE_KEYS.BROWSER.SELECTION_ACTION_CHUNK,
            payload: {
              delta: chunk.delta ?? "",
              thinkingDelta: chunk.thinkingDelta ?? ""
            }
          })
        }
        if (chunk.done) {
          safePostMessage(port, {
            type: MESSAGE_KEYS.BROWSER.SELECTION_ACTION_DONE
          })
        }
      },
      ac.signal
    )
  } catch (error) {
    logger.error("Selection action failed", "handleSelectionAction", { error })
    safePostMessage(port, {
      type: MESSAGE_KEYS.BROWSER.SELECTION_ACTION_ERROR,
      error: {
        status: 0,
        message: getErrorMessage(error)
      }
    })
  } finally {
    setAbortController(port.name, null)
  }
}
