import { browser, supportsTabGroups } from "@/lib/browser-api"
import { logger } from "@/lib/logger"
import { hasPermission } from "@/lib/permissions"

/**
 * Tabs the agent opens, gathered into one labelled group per run.
 *
 * A run that opened three tabs left three anonymous tabs beside the user's
 * own, with nothing to say which were the agent's to close. Claude in Chrome
 * and ChatGPT's extension both group the tabs they work in; this groups the
 * ones a run opened — never the tab the user started on, which stays where
 * they put it. `tabGroups` is an optional permission, so without it the
 * tabs open ungrouped exactly as before.
 *
 * Keyed by run, so a later run started from the same tab gets its own group.
 * Calls for one run are chained: two tabs opened together both reading "no
 * group yet" would make two groups. The map is memory only, so a worker
 * restart starts a fresh group rather than guessing which one was the run's.
 */
const groupByRun = new Map<string, Promise<number | undefined>>()
const MAX_REMEMBERED_RUNS = 50

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

const createGroup = async (tabId: number): Promise<number> => {
  const tabs = browser.tabs as unknown as TabsGroupApi
  const groupId = await tabs.group({ tabIds: tabId })
  await (
    browser as unknown as { tabGroups?: TabGroupsUpdateApi }
  ).tabGroups?.update(groupId, {
    title: groupTitle(),
    color: AGENT_TAB_GROUP_COLOR
  })
  return groupId
}

const addToGroup = async (
  existing: number | undefined,
  tabId: number
): Promise<number | undefined> => {
  try {
    if (!supportsTabGroups() || !(await hasPermission("tabGroups")))
      return existing
    if (existing === undefined) return await createGroup(tabId)
    try {
      const tabs = browser.tabs as unknown as TabsGroupApi
      return await tabs.group({ tabIds: tabId, groupId: existing })
    } catch {
      /** The user closed or ungrouped it; the run's next tabs start anew. */
      return await createGroup(tabId)
    }
  } catch (error) {
    /**
     * A permission query that failed, a window the tab moved to, a browser
     * that refused: the tab is open either way, and a group is a courtesy.
     */
    logger.debug("Agent tab was not grouped", "AgentTabGroup", { error })
    return existing
  }
}

export const groupAgentTab = (runId: string, tabId: number): Promise<void> => {
  const previous = groupByRun.get(runId) ?? Promise.resolve(undefined)
  const next = previous.then((existing) => addToGroup(existing, tabId))
  groupByRun.delete(runId)
  if (groupByRun.size >= MAX_REMEMBERED_RUNS) {
    const oldest = groupByRun.keys().next().value
    if (oldest !== undefined) groupByRun.delete(oldest)
  }
  groupByRun.set(runId, next)
  return next.then(() => undefined)
}

/** For tests: forget every group this worker made. */
export const resetAgentTabGroups = (): void => {
  groupByRun.clear()
}
