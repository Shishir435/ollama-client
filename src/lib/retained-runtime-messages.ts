import type { Tabs } from "webextension-polyfill"
import { browser } from "@/lib/browser-api"
import { MESSAGE_KEYS } from "@/lib/constants"
import type { ChromeResponse, ProviderModel } from "@/types"

type RuntimeResponse<T = object> = Omit<ChromeResponse, keyof T> & T

/**
 * Untyped runtime messages the background still answers.
 *
 * Provider and model request/response operations moved to the typed RPC
 * boundary (`extensionRpcClient` + `RpcMethod`); anything left here is a
 * one-way event, a lifecycle signal, or the content-script-reachable model
 * read. New request/response work belongs in `src/protocol/`, not this map.
 */
export interface RuntimeMessageMap {
  [MESSAGE_KEYS.PROVIDER.GET_MODELS]: {
    request: { type: typeof MESSAGE_KEYS.PROVIDER.GET_MODELS }
    response: RuntimeResponse<{ data?: { models: ProviderModel[] } }>
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
      // The address-bar disposition (Enter vs Alt/Meta+Enter). Forwarded for
      // completeness; the quick-ask always opens the side panel, so it is not
      // currently acted on. See use-omnibox-query.ts.
      disposition?: "currentTab" | "newForegroundTab" | "newBackgroundTab"
      // Marks the message as background-originated (see message-router).
      fromBackground?: boolean
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
  [MESSAGE_KEYS.APP.CLOSE_DEXIE]: {
    request: { type: typeof MESSAGE_KEYS.APP.CLOSE_DEXIE }
    response: RuntimeResponse
  }
  [MESSAGE_KEYS.APP.REOPEN_DEXIE]: {
    request: { type: typeof MESSAGE_KEYS.APP.REOPEN_DEXIE }
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
