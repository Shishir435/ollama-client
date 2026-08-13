/** Transport-agnostic extension sender categories. */
export type RuntimeSenderSurface =
  | "extension-page"
  | "content-script"
  | "untrusted"

/** Minimal sender evidence required for deterministic classification. */
export interface RuntimeSenderLike {
  id?: string
  origin?: string
  tab?: { id?: number }
  url?: string
}

/** Classify sender evidence without reading browser globals or policy tables. */
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
