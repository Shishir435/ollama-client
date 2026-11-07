import { browser } from "@/lib/browser-api"
import { classifyTabAccess } from "@/lib/browser-tab-access"
import { logger } from "@/lib/logger"

/** The manifest-registered selection loader, as the build names it. */
const SELECTION_LOADER_FILE = "content-scripts/selection-button.js"

/**
 * Put a live selection loader back into tabs that were open before an update
 * or reload. The browser registers content scripts for pages opened from then
 * on, and leaves the old ones in already-open pages running against an
 * extension context that no longer exists, so selecting text there did nothing
 * until the tab was refreshed. A freshly injected loader announces itself under
 * its own script name, which is what makes the orphaned instance stand down.
 */
export const reinjectSelectionLoader = async (): Promise<void> => {
  const tabs = await browser.tabs.query({ url: ["http://*/*", "https://*/*"] })
  await Promise.all(
    tabs.map(async (tab) => {
      if (typeof tab.id !== "number") return
      if ((await classifyTabAccess(tab.url)) !== "ok") return
      try {
        if (browser.scripting?.executeScript) {
          await browser.scripting.executeScript({
            target: { tabId: tab.id, allFrames: true },
            files: [SELECTION_LOADER_FILE]
          })
        } else {
          // Firefox MV2 has no `scripting` namespace.
          await browser.tabs.executeScript(tab.id, {
            file: `/${SELECTION_LOADER_FILE}`,
            allFrames: true
          })
        }
      } catch (error) {
        logger.debug("Selection loader reinjection skipped", "BackgroundSW", {
          error,
          tabId: tab.id
        })
      }
    })
  )
}
