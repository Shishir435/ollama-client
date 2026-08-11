import { RpcMethod } from "@ollama-client/contracts/rpc"
import { useStorage } from "@plasmohq/storage/hook"
import { useQuery } from "@tanstack/react-query"
import { useMemo } from "react"
import { STORAGE_KEYS } from "@/lib/constants"
import { plasmoGlobalStorage } from "@/lib/plasmo-global-storage"
import { type ProviderConfig, ProviderStorageKey } from "@/lib/providers/types"
import { queryKeys } from "@/lib/query-keys"
import { extensionRpcClient } from "@/protocol/extension-client"

const EMPTY_ICONS: Record<string, string> = {}

/**
 * Site icons for providers we have no curated mark for, keyed by provider id.
 *
 * Deliberately a separate query from the model list: the icons are per
 * provider rather than per model, they are fetched from the network on a cache
 * miss, and a provider that never answers must not make the model menu wait.
 * A failure resolves to no icons, which is the same as the normal case of
 * every provider being recognized already.
 */
export const useProviderIcons = (): Record<string, string> => {
  const [enabled] = useStorage<boolean>(
    {
      key: STORAGE_KEYS.PROVIDER.FAVICON_LOOKUP,
      instance: plasmoGlobalStorage
    },
    true
  )

  /*
   * Keyed on the stored provider configuration: a newly added provider must be
   * looked up now, not after the hour-long stale window on a result that was
   * computed before it existed.
   */
  const [providerConfig] = useStorage<ProviderConfig[]>(
    { key: ProviderStorageKey.CONFIG, instance: plasmoGlobalStorage },
    []
  )

  const { data } = useQuery({
    queryKey: [...queryKeys.model.providerIcons(), providerConfig],
    queryFn: () => extensionRpcClient.call(RpcMethod.ProvidersIcons, {}),
    enabled,
    staleTime: 60 * 60 * 1000,
    gcTime: 24 * 60 * 60 * 1000,
    retry: false
  })

  return useMemo(() => {
    // Turning the setting off hides what was already fetched on the next
    // render, rather than only stopping the next fetch.
    if (!enabled || !data?.icons.length) return EMPTY_ICONS
    return Object.fromEntries(
      data.icons.map(({ providerId, dataUrl }) => [providerId, dataUrl])
    )
  }, [data, enabled])
}
