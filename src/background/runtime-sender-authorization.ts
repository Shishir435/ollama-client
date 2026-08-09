import {
  classifyRuntimeSender,
  type RuntimeSenderLike
} from "@ollama-client/runtime-core/runtime-sender"
import { isRuntimeTransportAllowed } from "@/protocol/runtime-transport-registry"

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
