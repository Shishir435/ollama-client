import { isRuntimeTransportAllowed } from "@/protocol/runtime-transport-registry"

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
    return isRuntimeTransportAllowed("message", type, surface)
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
    return isRuntimeTransportAllowed("port", portName, surface)
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
    isRuntimeTransportAllowed("port", portName, surface) &&
    isRuntimeTransportAllowed("port-message", messageType, surface)
  )
}
