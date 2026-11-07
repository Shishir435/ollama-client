import type { ProvidersToggleCloudModelsResult } from "@ollama-client/contracts/provider-rpc"
import { readSetting, writeSetting } from "@/lib/storage/setting-access"
import { SETTINGS } from "@/lib/storage/settings"

/** The background owns one queue across all extension pages and pickers. */
let pending = Promise.resolve()

/** Serialize saves only; catalog queries must not delay another picker's click. */
export const toggleCloudModels = (
  signal: AbortSignal
): Promise<ProvidersToggleCloudModelsResult> => {
  const request = pending.then(async () => {
    signal.throwIfAborted()
    const enabled = await readSetting(SETTINGS.OLLAMA_CLOUD_MODELS)
    signal.throwIfAborted()
    await writeSetting(SETTINGS.OLLAMA_CLOUD_MODELS, !enabled)
    return { enabled: !enabled }
  })
  pending = request.then(
    () => undefined,
    () => undefined
  )
  return request
}
