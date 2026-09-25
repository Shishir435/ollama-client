import { browser, supportsTabGroups } from "@/lib/browser-api"
import { logger } from "@/lib/logger"
import { hasPermission } from "@/lib/permissions"

/**
 * Tabs the agent opens, gathered into one labelled group.
 *
 * A run that opened three tabs left three anonymous tabs beside the user's
 * own, with nothing to say which were the agent's to close. Claude in Chrome
 * and ChatGPT's extension both group the tabs they work in; this groups the
 * ones a run opened — never the tab the user started on, which stays where
 * they put it. `tabGroups` is an optional permission, so without it the
 * tabs open ungrouped exactly as before.
 *
 * Keyed by tab rather than by run: a tab the agent opened from another tab it
 * opened joins that tab's group, which is the chain a run makes. The map is
 * memory only, so a worker restart starts a fresh group rather than guessing
 * which existing one was the run's.
 */
const groupByTab = new Map<number, number>()
const MAX_REMEMBERED_TABS = 200

type TabsGroupApi = {
  group(options: {
    tabIds: number | number[]
    groupId?: number
  }): Promise<number>
}
type TabGroupsUpdateApi = {
  update(
    groupId: number,
    properties: { title?: string; color?: string; collapsed?: boolean }
  ): Promise<unknown>
}

export const AGENT_TAB_GROUP_COLOR = "purple"

const remember = (tabId: number, groupId: number): void => {
  groupByTab.delete(tabId)
  if (groupByTab.size >= MAX_REMEMBERED_TABS) {
    const oldest = groupByTab.keys().next().value
    if (oldest !== undefined) groupByTab.delete(oldest)
  }
  groupByTab.set(tabId, groupId)
}

/**
 * The group is labelled with the extension's own short name, which Chrome
 * already has in the reader's language: the tabs are this extension's, and
 * that is what the label has to say.
 */
const groupTitle = (): string => {
  try {
    return browser.i18n.getMessage("extShortName") || ""
  } catch {
    return ""
  }
}

export const groupAgentTab = async (
  openerTabId: number,
  tabId: number
): Promise<void> => {
  if (!supportsTabGroups() || !(await hasPermission("tabGroups"))) return
  const tabs = browser.tabs as unknown as TabsGroupApi
  const tabGroups = (browser as unknown as { tabGroups?: TabGroupsUpdateApi })
    .tabGroups
  try {
    const existing = groupByTab.get(openerTabId)
    const groupId = await tabs.group(
      existing === undefined
        ? { tabIds: tabId }
        : { tabIds: tabId, groupId: existing }
    )
    if (existing === undefined) {
      await tabGroups?.update(groupId, {
        title: groupTitle(),
        color: AGENT_TAB_GROUP_COLOR
      })
    }
    remember(tabId, groupId)
    /** The next tab opened from the same page joins this group too. */
    remember(openerTabId, groupId)
  } catch (error) {
    /**
     * A group that was closed, a window the tab moved to, a browser that
     * refused: the tab is open either way, and a group is a courtesy.
     */
    groupByTab.delete(openerTabId)
    logger.debug("Agent tab was not grouped", "AgentTabGroup", { error })
  }
}

/** For tests: forget every group this worker made. */
export const resetAgentTabGroups = (): void => {
  groupByTab.clear()
}
