import {
  supportsSessions,
  supportsSyncedSessions,
  supportsTabGroups
} from "@/lib/browser-api"
import type {
  ToolContext,
  ToolDefinition,
  ToolResult,
  ToolSource
} from "../types"
import {
  clickDefinition,
  findInPageDefinition,
  isAgentBrowserTool,
  navigateDefinition,
  openTabDefinition,
  runClick,
  runFindInPage,
  runNavigate,
  runOpenTab,
  runScroll,
  runSelect,
  runSnapshotPage,
  runType,
  scrollDefinition,
  selectDefinition,
  snapshotPageDefinition,
  typeDefinition
} from "./agent-browser-tools"
import {
  recentHistoryDefinition,
  runRecentHistory,
  runSearchBookmarks,
  searchBookmarksDefinition
} from "./browser-knowledge-tools"
import {
  listRecentlyClosedDefinition,
  listSyncedSessionsDefinition,
  restoreSessionDefinition,
  runListRecentlyClosed,
  runListSyncedSessions,
  runRestoreSession
} from "./browser-session-tools"
import {
  captureScreenshotDefinition,
  runCaptureScreenshot
} from "./capture-screenshot-tool"
import { currentTabDefinition, runCurrentTab } from "./current-tab-tool"
import { fileSearchDefinition, runFileSearch } from "./file-search-tool"
import { listTabsDefinition, runListTabs } from "./list-tabs-tool"
import { ragSearchDefinition, runRagSearch } from "./rag-search-tool"
import { readTabDefinition, runReadTab } from "./read-tab-tool"
import { runSaveArtifact, saveArtifactDefinition } from "./save-artifact-tool"
import {
  cancelReminderDefinition,
  listRemindersDefinition,
  runCancelReminder,
  runListReminders,
  runScheduleReminder,
  scheduleReminderDefinition
} from "./schedule-reminder-tool"
import { runSelectedText, selectedTextDefinition } from "./selected-text-tool"
import {
  listTabGroupsDefinition,
  readTabGroupDefinition,
  runListTabGroups,
  runReadTabGroup
} from "./tab-group-tools"

interface InternalTool {
  definition: ToolDefinition
  run: (args: Record<string, unknown>, ctx: ToolContext) => Promise<ToolResult>
}

/**
 * Built-in tools that run inside the extension. Add a tool by appending to this
 * list — the registry, adapters, loop, and trace UI need no change.
 */
const INTERNAL_TOOLS: InternalTool[] = [
  { definition: ragSearchDefinition, run: runRagSearch },
  { definition: fileSearchDefinition, run: runFileSearch },
  { definition: currentTabDefinition, run: runCurrentTab },
  { definition: listTabsDefinition, run: runListTabs },
  { definition: readTabDefinition, run: runReadTab },
  { definition: listTabGroupsDefinition, run: runListTabGroups },
  { definition: readTabGroupDefinition, run: runReadTabGroup },
  { definition: selectedTextDefinition, run: runSelectedText },
  { definition: recentHistoryDefinition, run: runRecentHistory },
  { definition: searchBookmarksDefinition, run: runSearchBookmarks },
  { definition: listRecentlyClosedDefinition, run: runListRecentlyClosed },
  { definition: restoreSessionDefinition, run: runRestoreSession },
  { definition: listSyncedSessionsDefinition, run: runListSyncedSessions },
  { definition: scheduleReminderDefinition, run: runScheduleReminder },
  { definition: listRemindersDefinition, run: runListReminders },
  { definition: cancelReminderDefinition, run: runCancelReminder },
  { definition: saveArtifactDefinition, run: runSaveArtifact },
  { definition: captureScreenshotDefinition, run: runCaptureScreenshot },
  { definition: snapshotPageDefinition, run: runSnapshotPage },
  { definition: openTabDefinition, run: runOpenTab },
  { definition: navigateDefinition, run: runNavigate },
  { definition: scrollDefinition, run: runScroll },
  { definition: findInPageDefinition, run: runFindInPage },
  { definition: clickDefinition, run: runClick },
  { definition: typeDefinition, run: runType },
  { definition: selectDefinition, run: runSelect }
]

const isToolVisible = async (tool: InternalTool): Promise<boolean> => {
  if (
    tool.definition.name === "list_tab_groups" ||
    tool.definition.name === "read_tab_group"
  ) {
    return supportsTabGroups()
  }
  if (
    tool.definition.name === "list_recently_closed" ||
    tool.definition.name === "restore_session"
  ) {
    return supportsSessions()
  }
  if (tool.definition.name === "list_synced_sessions") {
    return supportsSyncedSessions()
  }
  return true
}

/**
 * The internal {@link ToolSource}. This is the first source; each future MCP
 * server registers as a sibling source with the same interface.
 */
export const createInternalToolSource = (): ToolSource => {
  const byName = new Map(
    INTERNAL_TOOLS.map((tool) => [tool.definition.name, tool])
  )
  return {
    id: "internal",
    listTools: async () => {
      const visible = await Promise.all(
        INTERNAL_TOOLS.map(async (tool) => ({
          tool,
          visible: await isToolVisible(tool)
        }))
      )
      return visible
        .filter((entry) => entry.visible)
        .map((entry) => entry.tool.definition)
    },
    callTool: async (name, args, ctx) => {
      const tool = byName.get(name)
      if (!tool) {
        return { content: `Unknown internal tool: ${name}`, isError: true }
      }
      if (ctx.agent && isAgentBrowserTool(name) && name !== "open_tab") {
        if (args.tabId === undefined) args.tabId = ctx.agent.targetTabId
        if (args.tabId !== ctx.agent.targetTabId) {
          return {
            content:
              "Agent target-tab mismatch. The run cannot act on a different tab without an approved navigation step.",
            isError: true
          }
        }
      }
      return tool.run(args, ctx)
    }
  }
}
