import type { Tabs } from "webextension-polyfill"
import { browser } from "@/lib/browser-api"
import { MESSAGE_KEYS } from "@/lib/constants"
import type {
  ChromeResponse,
  ProviderModel,
  ProviderModelDetails
} from "@/types"

type RuntimeResponse<T = object> = Omit<ChromeResponse, keyof T> & T

export interface LoadedRuntimeModel {
  name: string
  model: string
  size: number
  digest: string
  details: {
    parent_model: string
    format: string
    family: string
    families: string[]
    parameter_size: string
    quantization_level: string
  }
  expires_at: string
  size_vram: number
}

export interface RuntimeMessageMap {
  [MESSAGE_KEYS.PROVIDER.GET_MODELS]: {
    request: { type: typeof MESSAGE_KEYS.PROVIDER.GET_MODELS }
    response: RuntimeResponse<{ data?: { models: ProviderModel[] } }>
  }
  [MESSAGE_KEYS.PROVIDER.SHOW_MODEL_DETAILS]: {
    request: {
      type: typeof MESSAGE_KEYS.PROVIDER.SHOW_MODEL_DETAILS
      payload: { model: string; providerId?: string }
    }
    response: RuntimeResponse<{ data?: ProviderModelDetails | null }>
  }
  [MESSAGE_KEYS.PROVIDER.SCRAPE_MODEL]: {
    request: {
      type: typeof MESSAGE_KEYS.PROVIDER.SCRAPE_MODEL
      query: string
    }
    response: RuntimeResponse<{ html?: string }>
  }
  [MESSAGE_KEYS.PROVIDER.SCRAPE_MODEL_VARIANTS]: {
    request: {
      type: typeof MESSAGE_KEYS.PROVIDER.SCRAPE_MODEL_VARIANTS
      name: string
    }
    response: RuntimeResponse<{ html?: string }>
  }
  [MESSAGE_KEYS.PROVIDER.CHECK_EMBEDDING_MODEL]: {
    request: {
      type: typeof MESSAGE_KEYS.PROVIDER.CHECK_EMBEDDING_MODEL
      payload: { model: string; providerId?: string }
    }
    response: RuntimeResponse<{ data?: { exists?: boolean; debug?: object } }>
  }
  [MESSAGE_KEYS.PROVIDER.GET_LOADED_MODELS]: {
    request: {
      type: typeof MESSAGE_KEYS.PROVIDER.GET_LOADED_MODELS
      payload?: { providerId?: string }
    }
    response: RuntimeResponse<{ data?: { models?: LoadedRuntimeModel[] } }>
  }
  [MESSAGE_KEYS.PROVIDER.UNLOAD_MODEL]: {
    request: {
      type: typeof MESSAGE_KEYS.PROVIDER.UNLOAD_MODEL
      payload: { model: string; providerId?: string }
    }
    response: RuntimeResponse
  }
  [MESSAGE_KEYS.PROVIDER.WARMUP_MODEL]: {
    request: {
      type: typeof MESSAGE_KEYS.PROVIDER.WARMUP_MODEL
      payload: {
        model: string
        providerId?: string
        previousModel?: string
        previousProviderId?: string
      }
    }
    response: RuntimeResponse
  }
  [MESSAGE_KEYS.PROVIDER.DELETE_MODEL]: {
    request: {
      type: typeof MESSAGE_KEYS.PROVIDER.DELETE_MODEL
      payload: string
    }
    response: RuntimeResponse
  }
  [MESSAGE_KEYS.PROVIDER.GET_PROVIDER_VERSION]: {
    request: { type: typeof MESSAGE_KEYS.PROVIDER.GET_PROVIDER_VERSION }
    response: RuntimeResponse<{ data?: { version?: string } }>
  }
  [MESSAGE_KEYS.PROVIDER.PREPARE_EMBEDDING_MODEL]: {
    request: {
      type: typeof MESSAGE_KEYS.PROVIDER.PREPARE_EMBEDDING_MODEL
      payload: { model: string; providerId?: string }
    }
    response: RuntimeResponse
  }
  [MESSAGE_KEYS.PROVIDER.EMBED_FILE_CHUNKS]: {
    request: {
      type: typeof MESSAGE_KEYS.PROVIDER.EMBED_FILE_CHUNKS
      payload?: unknown
    }
    response: RuntimeResponse
  }
  [MESSAGE_KEYS.PROVIDER.UPDATE_BASE_URL]: {
    request: {
      type: typeof MESSAGE_KEYS.PROVIDER.UPDATE_BASE_URL
      payload: string
    }
    response: RuntimeResponse
  }
  [MESSAGE_KEYS.BROWSER.OPEN_TAB]: {
    request: { type: typeof MESSAGE_KEYS.BROWSER.OPEN_TAB }
    response: RuntimeResponse<{ tabs?: Tabs.Tab[] }>
  }
  [MESSAGE_KEYS.BROWSER.ADD_SELECTION_TO_CHAT]: {
    request: {
      type: typeof MESSAGE_KEYS.BROWSER.ADD_SELECTION_TO_CHAT
      payload: string
    }
    response: RuntimeResponse
  }
  [MESSAGE_KEYS.BROWSER.OMNIBOX_QUERY]: {
    request: {
      type: typeof MESSAGE_KEYS.BROWSER.OMNIBOX_QUERY
      payload: string
    }
    response: RuntimeResponse
  }
  [MESSAGE_KEYS.APP.RELOAD]: {
    request: { type: typeof MESSAGE_KEYS.APP.RELOAD }
    response: RuntimeResponse
  }
  [MESSAGE_KEYS.APP.FLUSH_SQLITE]: {
    request: { type: typeof MESSAGE_KEYS.APP.FLUSH_SQLITE }
    response: RuntimeResponse
  }
  [MESSAGE_KEYS.APP.NOTIFY_JOB_COMPLETE]: {
    request: {
      type: typeof MESSAGE_KEYS.APP.NOTIFY_JOB_COMPLETE
      payload: { id?: string; title: string; message: string }
    }
    response: RuntimeResponse
  }
}

export type RuntimeMessageKey = keyof RuntimeMessageMap
export type RuntimeMessage<K extends RuntimeMessageKey> =
  RuntimeMessageMap[K]["request"]
export type RuntimeMessageResponse<K extends RuntimeMessageKey> =
  RuntimeMessageMap[K]["response"]
type RuntimeMessageBody<K extends RuntimeMessageKey> = Omit<
  RuntimeMessage<K>,
  "type"
>

export async function sendRuntimeMessage<K extends RuntimeMessageKey>(
  type: K,
  ...args: keyof RuntimeMessageBody<K> extends never
    ? [body?: RuntimeMessageBody<K>]
    : [body: RuntimeMessageBody<K>]
): Promise<RuntimeMessageResponse<K>> {
  const body = args[0] ?? {}
  return (await browser.runtime.sendMessage({
    type,
    ...body
  } as RuntimeMessage<K>)) as RuntimeMessageResponse<K>
}
