import { STORAGE_KEYS } from "@/lib/constants"
import { setPlasmoStoredValue } from "@/lib/plasmo-global-storage"
import {
  SELECTION_CONTEXT_MAX_CHARS,
  type SelectionContextHandoff
} from "@/protocol/selection-handoff"

/**
 * The page address without its query or fragment: a query string is where
 * sites keep search terms and one-time codes, and the source line only needs
 * to say where the text came from.
 */
export const selectionSourceUrl = (
  url: string | undefined
): string | undefined => {
  if (!url) return undefined
  try {
    const parsed = new URL(url)
    if (!/^(https?|file):$/.test(parsed.protocol)) return undefined
    return `${parsed.origin === "null" ? "file://" : parsed.origin}${parsed.pathname}`
  } catch {
    return undefined
  }
}

/**
 * Stage a selection to be added to the chat as context, and return what the
 * panel should receive. Source details come from the sender's tab, which the
 * browser supplies, never from the page's own message.
 */
export const stageSelectionContext = async (
  text: string,
  tab: { windowId?: number; title?: string; url?: string } | undefined
): Promise<SelectionContextHandoff> => {
  const url = selectionSourceUrl(tab?.url)
  const handoff: SelectionContextHandoff = {
    kind: "context",
    id: crypto.randomUUID(),
    text: text.slice(0, SELECTION_CONTEXT_MAX_CHARS),
    ...(tab?.title && { title: tab.title.slice(0, 300) }),
    ...(url && url.length <= 2048 && { url }),
    ...(typeof tab?.windowId === "number" && { windowId: tab.windowId })
  }
  await setPlasmoStoredValue(
    STORAGE_KEYS.BROWSER.PENDING_SELECTION_TEXT,
    handoff
  )
  return handoff
}
