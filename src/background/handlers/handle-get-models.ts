import { createErrorResponse } from "@/background/lib/error-handler"
import { safeSendResponse } from "@/background/lib/utils"
import { DEFAULT_PROVIDER_ID } from "@/lib/constants"
import { ProviderRpcService } from "@/lib/providers/provider-rpc-service"
import type { SendResponseFunction } from "@/types"

export const handleGetModels = async (
  sendResponse: SendResponseFunction
): Promise<void> => {
  try {
    const result = await ProviderRpcService.listModels({
      providerId: DEFAULT_PROVIDER_ID,
      enabledOnly: false
    })
    safeSendResponse(sendResponse, {
      success: true,
      data: { models: result.models }
    })
  } catch (err) {
    safeSendResponse(sendResponse, createErrorResponse(err))
  }
}
