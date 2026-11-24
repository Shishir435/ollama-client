import { openOptionsInTab, runtime } from "@/lib/browser-api"

/**
 * The registry is the whole settings catalog (about 200 KB), needed only when a
 * link opens a setting, so it loads on that click rather than with the side
 * panel.
 */
const settingsTabForFocusId = async (
  focusId: string
): Promise<string | undefined> => {
  const { SETTINGS_REGISTRY } = await import("./settings-registry")
  return SETTINGS_REGISTRY.find((entry) => entry.id === focusId)?.tab
}

/**
 * Open the options page on one setting. The tab comes from the registry, so
 * moving a control between tabs cannot silently break the deep link; a lookup
 * that fails still opens the page and lets it resolve the focus id itself.
 */
export const openSettingsFocus = async (focusId: string): Promise<void> => {
  const tab = await settingsTabForFocusId(focusId).catch(() => undefined)
  await openOptionsInTab(
    runtime.getURL(`options.html${tab ? `?tab=${tab}&` : "?"}focus=${focusId}`)
  )
}
