import { createErrorResponse } from "@/background/lib/error-handler"
import { safeSendResponse } from "@/background/lib/utils"
import { ProviderFactory } from "@/lib/providers/factory"
import type { ProviderModelDetails, SendResponseFunction } from "@/types"

const compactModelDetails = (
  data: ProviderModelDetails | null
): ProviderModelDetails | null => {
  if (!data) return null
  return {
    ...(data.details && { details: data.details }),
    ...(data.model_info && { model_info: data.model_info }),
    ...(data.capabilities && { capabilities: data.capabilities })
  }
}

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
      // Legit "no details" — the resolved provider can't self-report. Tell the
      // client the truth so it doesn't treat this null as a transport failure.
      safeSendResponse(sendResponse, {
        success: true,
        data: null,
        providerId: provider.id,
        supportsDetails: false
      })
      return
    }

    const data = await provider.getModelDetails(model)

    // `/api/show` may include large license, tensor, template, and Modelfile
    // fields. Model settings only consumes these three metadata fields; keep
    // runtime messages small and consistently serializable.
    safeSendResponse(sendResponse, {
      success: true,
      data: compactModelDetails(data),
      providerId: provider.id,
      supportsDetails: true
    })
  } catch (err) {
    safeSendResponse(sendResponse, createErrorResponse(err))
  }
}
