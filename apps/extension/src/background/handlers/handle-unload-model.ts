import { getBaseUrl, safeSendResponse } from "@/background/lib/utils"
import { ProviderFactory } from "@/lib/providers/factory"
import { ProviderId } from "@/lib/providers/types"
import type { SendResponseFunction } from "@/types"

export const handleUnloadModel = async (
  payload: string | { model: string; providerId?: string },
  sendResponse: SendResponseFunction
): Promise<void> => {
  try {
    const modelName = typeof payload === "string" ? payload : payload.model
    const providerId =
      typeof payload === "string" ? undefined : payload.providerId
    const provider = await ProviderFactory.getProviderForModel(
      modelName,
      providerId
    )
    const baseUrl = providerId
      ? provider.config.baseUrl || (await getBaseUrl())
      : await getBaseUrl()

    if (provider.id === ProviderId.LM_STUDIO) {
      const res = await fetch(
        `${baseUrl.replace(/\/v1\/?$/, "")}/api/v1/models/unload`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ model: modelName })
        }
      )
      if (!res.ok) {
        safeSendResponse(sendResponse, {
          success: false,
          error: { status: res.status, message: res.statusText }
        })
        return
      }
      safeSendResponse(sendResponse, { success: true })
      return
    }

    const res = await fetch(`${baseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: modelName,
        messages: [],
        keep_alive: 0
      })
    })

    if (!res.ok) {
      safeSendResponse(sendResponse, {
        success: false,
        error: { status: res.status, message: res.statusText }
      })
      return
    }

    const data = await res.json()
    const wasUnloaded = data.done_reason === "unload"

    safeSendResponse(sendResponse, { success: wasUnloaded, data })
  } catch (err) {
    const error = err as Error
    safeSendResponse(sendResponse, {
      success: false,
      error: { status: 0, message: error.message }
    })
  }
}
