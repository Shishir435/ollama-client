import { getBaseUrl, safeSendResponse } from "@/background/lib/utils"
import { ProviderFactory } from "@/lib/providers/factory"
import { ProviderId } from "@/lib/providers/types"
import type { SendResponseFunction } from "@/types"

export const handleGetLoadedModels = async (
  payload: { providerId?: string } | undefined,
  sendResponse: SendResponseFunction
): Promise<void> => {
  try {
    const providerId = payload?.providerId
    const provider = providerId
      ? await ProviderFactory.getProvider(providerId)
      : await ProviderFactory.getProvider(ProviderId.OLLAMA)
    const baseUrl = providerId
      ? provider.config.baseUrl || (await getBaseUrl())
      : await getBaseUrl()

    const isLmStudio = provider.id === ProviderId.LM_STUDIO
    const endpoint = isLmStudio
      ? `${baseUrl.replace(/\/v1\/?$/, "")}/api/v1/models`
      : `${baseUrl}/api/ps`
    const res = await fetch(endpoint)
    if (!res.ok) {
      safeSendResponse(sendResponse, {
        success: false,
        error: { status: res.status, message: res.statusText }
      })
      return
    }

    const data = await res.json()
    if (isLmStudio) {
      const models = Array.isArray(data?.data) ? data.data : []
      safeSendResponse(sendResponse, { success: true, data: { models } })
      return
    }
    safeSendResponse(sendResponse, { success: true, data })
  } catch (err) {
    const error = err as Error
    safeSendResponse(sendResponse, {
      success: false,
      error: { status: 0, message: error.message }
    })
  }
}
