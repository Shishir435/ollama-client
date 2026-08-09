import {
  classifyRuntimeSender,
  type RuntimeSenderLike
} from "@ollama-client/runtime-core/runtime-sender"

/** Privileged persistence traffic is never available to content scripts. */
export const isTrustedPersistenceSender = (
  sender: RuntimeSenderLike,
  extensionId: string,
  extensionUrlPrefix: string
): boolean =>
  classifyRuntimeSender(sender, extensionId, extensionUrlPrefix) ===
  "extension-page"

/** Marker writes are reserved for the Chromium offscreen owner document. */
export const isPersistenceOwnerSender = (
  sender: RuntimeSenderLike,
  extensionId: string,
  extensionUrlPrefix: string,
  ownerUrl: string
): boolean => {
  if (!isTrustedPersistenceSender(sender, extensionId, extensionUrlPrefix)) {
    return false
  }
  if (!sender.url) return false
  try {
    const actual = new URL(sender.url)
    const expected = new URL(ownerUrl)
    return (
      actual.origin === expected.origin &&
      actual.pathname === expected.pathname &&
      actual.searchParams.get("owner") === "1"
    )
  } catch {
    return false
  }
}
