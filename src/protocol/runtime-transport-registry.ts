import { MESSAGE_KEYS } from "@/lib/constants"

export type RuntimeTransport = "message" | "port" | "port-message"
export type RuntimeOperation = "query" | "command" | "event" | "stream"
export type RuntimeSource = "extension-page" | "content-script"

export interface RuntimeTransportDefinition {
  type: string
  transport: RuntimeTransport
  operation: RuntimeOperation
  allowedSources: readonly RuntimeSource[]
}

const extensionPage = ["extension-page"] as const
const extensionOrContent = ["extension-page", "content-script"] as const

/**
 * Policy ledger for runtime traffic that intentionally remains outside the
 * typed request/response RPC boundary.
 *
 * New request/response operations belong in RpcMethod. Entries here cover
 * streaming ports, lifecycle commands, one-way events, content-script reads,
 * and messages delivered to extension/content-page listeners.
 */
export const RUNTIME_TRANSPORT_DEFINITIONS = [
  {
    type: MESSAGE_KEYS.PROVIDER.GET_MODELS,
    transport: "message",
    operation: "query",
    allowedSources: extensionOrContent
  },
  {
    type: MESSAGE_KEYS.PROVIDER.CHAT_WITH_MODEL,
    transport: "port-message",
    operation: "stream",
    allowedSources: extensionPage
  },
  {
    type: MESSAGE_KEYS.PROVIDER.START_TURN,
    transport: "port-message",
    operation: "stream",
    allowedSources: extensionPage
  },
  {
    type: MESSAGE_KEYS.PROVIDER.BUILD_CONTEXT,
    transport: "port-message",
    operation: "stream",
    allowedSources: extensionPage
  },
  {
    type: MESSAGE_KEYS.PROVIDER.STREAM_RESPONSE,
    transport: "port",
    operation: "stream",
    allowedSources: extensionPage
  },
  {
    type: MESSAGE_KEYS.PROVIDER.STOP_GENERATION,
    transport: "port-message",
    operation: "command",
    allowedSources: extensionPage
  },
  {
    type: MESSAGE_KEYS.PROVIDER.PULL_MODEL,
    transport: "port",
    operation: "stream",
    allowedSources: extensionPage
  },
  {
    type: MESSAGE_KEYS.PROVIDER.START_SELECTION_ACTION,
    transport: "port",
    operation: "stream",
    allowedSources: extensionOrContent
  },
  {
    type: MESSAGE_KEYS.PROVIDER.START_SELECTION_ACTION,
    transport: "port-message",
    operation: "stream",
    allowedSources: extensionOrContent
  },
  {
    type: MESSAGE_KEYS.PROVIDER.CANCEL_SELECTION_ACTION,
    transport: "port-message",
    operation: "command",
    allowedSources: extensionOrContent
  },
  {
    type: MESSAGE_KEYS.PROVIDER.CONFIRM_TOOL,
    transport: "message",
    operation: "command",
    allowedSources: extensionPage
  },
  {
    type: MESSAGE_KEYS.OLLAMA.STREAM_RESPONSE,
    transport: "port",
    operation: "stream",
    allowedSources: extensionPage
  },
  {
    type: MESSAGE_KEYS.OLLAMA.PULL_MODEL,
    transport: "port",
    operation: "stream",
    allowedSources: extensionPage
  },
  {
    type: MESSAGE_KEYS.BROWSER.OPEN_TAB,
    transport: "message",
    operation: "query",
    allowedSources: extensionPage
  },
  {
    type: MESSAGE_KEYS.BROWSER.GET_PAGE_CONTENT,
    transport: "message",
    operation: "query",
    allowedSources: extensionPage
  },
  {
    type: MESSAGE_KEYS.BROWSER.ADD_SELECTION_TO_CHAT,
    transport: "message",
    operation: "command",
    allowedSources: extensionOrContent
  },
  {
    type: MESSAGE_KEYS.BROWSER.ADD_SELECTION_TO_CHAT,
    transport: "port-message",
    operation: "event",
    allowedSources: extensionPage
  },
  {
    type: MESSAGE_KEYS.BROWSER.LOAD_SELECTION_OVERLAY,
    transport: "message",
    operation: "command",
    allowedSources: extensionOrContent
  },
  {
    type: MESSAGE_KEYS.BROWSER.OMNIBOX_QUERY,
    transport: "message",
    operation: "event",
    allowedSources: extensionPage
  },
  {
    type: MESSAGE_KEYS.BROWSER.SELECTION_BRIDGE_PORT,
    transport: "port",
    operation: "event",
    allowedSources: extensionPage
  },
  {
    type: MESSAGE_KEYS.BROWSER.SELECTION_ACTION_CHUNK,
    transport: "port-message",
    operation: "stream",
    allowedSources: extensionPage
  },
  {
    type: MESSAGE_KEYS.BROWSER.SELECTION_ACTION_DONE,
    transport: "port-message",
    operation: "stream",
    allowedSources: extensionPage
  },
  {
    type: MESSAGE_KEYS.BROWSER.SELECTION_ACTION_ERROR,
    transport: "port-message",
    operation: "stream",
    allowedSources: extensionPage
  },
  {
    type: MESSAGE_KEYS.APP.RELOAD,
    transport: "message",
    operation: "command",
    allowedSources: extensionPage
  },
  {
    type: MESSAGE_KEYS.APP.FLUSH_SQLITE,
    transport: "message",
    operation: "command",
    allowedSources: extensionPage
  },
  {
    type: MESSAGE_KEYS.APP.CLOSE_DEXIE,
    transport: "message",
    operation: "command",
    allowedSources: extensionPage
  },
  {
    type: MESSAGE_KEYS.APP.REOPEN_DEXIE,
    transport: "message",
    operation: "command",
    allowedSources: extensionPage
  },
  {
    type: MESSAGE_KEYS.APP.NOTIFY_JOB_COMPLETE,
    transport: "message",
    operation: "command",
    allowedSources: extensionPage
  },
  {
    type: MESSAGE_KEYS.APP.KEEP_TOOL_LOOP_ALIVE,
    transport: "message",
    operation: "event",
    allowedSources: extensionPage
  }
] as const satisfies readonly RuntimeTransportDefinition[]

export const isRuntimeTransportAllowed = (
  transport: RuntimeTransport,
  type: string,
  source: RuntimeSource
): boolean =>
  RUNTIME_TRANSPORT_DEFINITIONS.some(
    (definition) =>
      definition.transport === transport &&
      definition.type === type &&
      (definition.allowedSources as readonly RuntimeSource[]).includes(source)
  )
