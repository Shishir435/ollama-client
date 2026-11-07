import type { ProvidersToggleCloudModelsResult } from "@ollama-client/contracts/provider-rpc"
import { DEFAULT_PROVIDER_ID } from "@/lib/constants"
import { ProviderRpcService } from "@/lib/providers/provider-rpc-service"
import { readSetting, writeSetting } from "@/lib/storage/setting-access"
import { SETTINGS } from "@/lib/storage/settings"

/** The background owns one queue across all extension pages and pickers. */
let pending = Promise.resolve()

/** Persist each toggle before refreshing the catalog that reads its value. */
export const toggleCloudModels = (
  signal: AbortSignal
): Promise<ProvidersToggleCloudModelsResult> => {
  const request = pending.then(async () => {
    signal.throwIfAborted()
    const enabled = await readSetting(SETTINGS.OLLAMA_CLOUD_MODELS)
    signal.throwIfAborted()
    await writeSetting(SETTINGS.OLLAMA_CLOUD_MODELS, !enabled)
    return ProviderRpcService.listModels(
      { providerId: DEFAULT_PROVIDER_ID },
      signal
    )
  })
  pending = request.then(
    () => undefined,
    () => undefined
  )
  return request
}
