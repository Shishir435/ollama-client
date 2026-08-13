import type { ProviderDraftInput } from "@ollama-client/contracts/provider-rpc"
import { RpcMethod } from "@ollama-client/contracts/rpc"
import {
  providerProfileRequiresApiKey,
  resolveProviderServiceProfile
} from "@/lib/providers/service-profile"
import type {
  CustomProviderWire,
  ProviderServiceProfile
} from "@/lib/providers/types"
import { extensionRpcClient } from "@/protocol/extension-client"
import {
  type ProviderDraft,
  providerDraftFromPublic,
  providerDraftHasUsableApiKey
} from "../types/provider-draft"

export interface AddProviderInput {
  name: string
  baseUrl: string
  wire: CustomProviderWire
  apiKey?: string
  customModels?: string[]
  serviceProfile?: ProviderServiceProfile
}

export const providerDraftToInput = (
  config: ProviderDraft
): ProviderDraftInput => ({
  id: String(config.id),
  type: config.type,
  enabled: config.enabled,
  name: config.name,
  apiKey: config.apiKey,
  ...(config.baseUrl !== undefined ? { baseUrl: config.baseUrl } : {}),
  ...(config.modelId !== undefined ? { modelId: config.modelId } : {}),
  ...(config.customModels !== undefined
    ? { customModels: config.customModels }
    : {}),
  ...(config.serviceProfile !== undefined
    ? { serviceProfile: config.serviceProfile }
    : {}),
  ...(config.compatibility !== undefined
    ? { compatibility: config.compatibility }
    : {})
})

export const loadProviderDrafts = async (): Promise<ProviderDraft[]> => {
  const { providers } = await extensionRpcClient.call(
    RpcMethod.ProvidersList,
    {}
  )
  return providers.map(providerDraftFromPublic)
}

export const saveProviderDraft = async (
  config: ProviderDraft
): Promise<ProviderDraft> => {
  const { provider } = await extensionRpcClient.call(
    RpcMethod.ProvidersUpsert,
    { target: "existing", config: providerDraftToInput(config) }
  )
  return providerDraftFromPublic(provider)
}

export const addProviderDraft = async (
  input: AddProviderInput
): Promise<ProviderDraft> => {
  const { provider } = await extensionRpcClient.call(
    RpcMethod.ProvidersUpsert,
    { target: "new", provider: input }
  )
  return providerDraftFromPublic(provider)
}

export const removeProviderDraft = async (
  providerId: string
): Promise<void> => {
  await extensionRpcClient.call(RpcMethod.ProvidersRemove, { providerId })
}

export const updateProviderEnabled = async (
  providerId: string,
  enabled: boolean
): Promise<ProviderDraft> => {
  const { provider } = await extensionRpcClient.call(
    RpcMethod.ProvidersSetEnabled,
    { providerId, enabled }
  )
  return providerDraftFromPublic(provider)
}

export const testProviderConnection = async (config: ProviderDraft) => {
  if (
    providerProfileRequiresApiKey(resolveProviderServiceProfile(config)) &&
    !providerDraftHasUsableApiKey(config)
  ) {
    return { kind: "api-key-required" } as const
  }

  const result = await extensionRpcClient.call(
    RpcMethod.ProvidersTestConnection,
    { target: "draft", config: providerDraftToInput(config) }
  )
  return { kind: "completed", result } as const
}
