import { MESSAGE_KEYS } from "@/lib/constants"

export type RuntimeSenderSurface =
  | "extension-page"
  | "content-script"
  | "untrusted"

export interface RuntimeSenderLike {
  id?: string
  origin?: string
  tab?: { id?: number }
  url?: string
}

const CONTENT_SCRIPT_MESSAGE_ALLOWLIST = new Set<string>([
  MESSAGE_KEYS.PROVIDER.GET_MODELS,
  MESSAGE_KEYS.OLLAMA.GET_MODELS,
  MESSAGE_KEYS.BROWSER.ADD_SELECTION_TO_CHAT
])

const CONTENT_SCRIPT_PORT_ALLOWLIST = new Set<string>([
  MESSAGE_KEYS.PROVIDER.START_SELECTION_ACTION
])

const CONTENT_SCRIPT_PORT_MESSAGE_ALLOWLIST = new Set<string>([
  MESSAGE_KEYS.PROVIDER.START_SELECTION_ACTION,
  MESSAGE_KEYS.PROVIDER.CANCEL_SELECTION_ACTION
])

export const classifyRuntimeSender = (
  sender: RuntimeSenderLike,
  extensionId: string,
  extensionUrlPrefix: string
): RuntimeSenderSurface => {
  if (!extensionId || sender.id !== extensionId) return "untrusted"
  if (
    sender.url?.startsWith(extensionUrlPrefix) ||
    (sender.origin && extensionUrlPrefix.startsWith(`${sender.origin}/`))
  ) {
    return "extension-page"
  }
  return sender.tab ? "content-script" : "extension-page"
}

export const isRuntimeMessageAllowed = (
  type: string,
  sender: RuntimeSenderLike,
  extensionId: string,
  extensionUrlPrefix: string
): boolean => {
  const surface = classifyRuntimeSender(sender, extensionId, extensionUrlPrefix)
  if (surface === "extension-page") return true
  if (surface === "content-script")
    return CONTENT_SCRIPT_MESSAGE_ALLOWLIST.has(type)
  return false
}

export const isRuntimePortAllowed = (
  portName: string,
  sender: RuntimeSenderLike,
  extensionId: string,
  extensionUrlPrefix: string
): boolean => {
  const surface = classifyRuntimeSender(sender, extensionId, extensionUrlPrefix)
  if (surface === "extension-page") return true
  if (surface === "content-script")
    return CONTENT_SCRIPT_PORT_ALLOWLIST.has(portName)
  return false
}

export const isRuntimePortMessageAllowed = (
  portName: string,
  messageType: string,
  sender: RuntimeSenderLike,
  extensionId: string,
  extensionUrlPrefix: string
): boolean => {
  const surface = classifyRuntimeSender(sender, extensionId, extensionUrlPrefix)
  if (surface === "extension-page") return true
  if (surface !== "content-script") return false
  return (
    CONTENT_SCRIPT_PORT_ALLOWLIST.has(portName) &&
    CONTENT_SCRIPT_PORT_MESSAGE_ALLOWLIST.has(messageType)
  )
}
