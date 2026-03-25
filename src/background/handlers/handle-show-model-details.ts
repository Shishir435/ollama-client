import { ProviderFactory } from "@/lib/providers/factory"
import type { SendResponseFunction } from "@/types"

export const handleShowModelDetails = async (
  payload: string | { model: string; providerId?: string },
  sendResponse: SendResponseFunction
): Promise<void> => {
  try {
    const model = typeof payload === "string" ? payload : payload.model
    const providerId =
      typeof payload === "string" ? undefined : payload.providerId
    const provider = await ProviderFactory.getProviderForModel(
      model,
      providerId
    )

    if (!provider.getModelDetails) {
      sendResponse({ success: true, data: null })
      return
    }

    const data = await provider.getModelDetails(model)
    sendResponse({ success: true, data })
  } catch (err) {
    const error = err as Error
    sendResponse({
      success: false,
      error: { status: 0, message: error.message }
    })
  }
}
