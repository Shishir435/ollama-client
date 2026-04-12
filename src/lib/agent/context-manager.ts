import type {
  AgentBrowserSession,
  WorkspaceTabInfo
} from "./browser-automation"
import { getPageContext, getWorkspaceTabs } from "./browser-automation"
import { AGENT_SYSTEM_PROMPT, JSON_AGENT_SYSTEM_PROMPT } from "./tools"
import type { InteractiveElement } from "./types"

export interface AgentLLMMessage {
  role: "system" | "user" | "assistant" | "tool"
  content: string
  images?: string[]
  tool_calls?: Array<{
    id?: string
    function: { name: string; arguments: string }
  }>
  tool_call_id?: string
  name?: string
}

export const formatWorkspaceForLLM = (tabs: WorkspaceTabInfo[]): string => {
  if (tabs.length === 0) return "No tracked tabs."

  return tabs
    .map((tab) => {
      const flags = [tab.isRoot ? "root" : null, tab.isActive ? "active" : null]
        .filter(Boolean)
        .join(", ")

      return `[tab_${tab.tabIndex}] ${tab.title.slice(0, 80)} - ${tab.url.slice(0, 120)}${flags ? ` (${flags})` : ""}`
    })
    .join("\n")
}

export const formatElementsForLLM = (
  elements: InteractiveElement[]
): string => {
  if (elements.length === 0) return "No interactive elements found on the page."
  const lines = elements.map((el) => {
    let desc = `[${el.id}] ${el.type.toUpperCase()}`
    if (el.text) desc += `: "${el.text.slice(0, 60)}"`
    if (el.placeholder) desc += ` (placeholder: "${el.placeholder}")`
    if (el.href) desc += ` → ${el.href.slice(0, 60)}`
    if (el.options && el.options.length > 0) {
      desc += ` [options: ${el.options.slice(0, 5).join(", ")}]`
    }
    if (el.disabled) desc += " (disabled)"
    return desc
  })
  return lines.join("\n")
}

export class ContextManager {
  private messages: AgentLLMMessage[] = []
  private jsonMessages: AgentLLMMessage[] = []

  constructor(
    private readonly task: string,
    private readonly visionMode: boolean
  ) {}

  public getMessages(
    mode: "tool-calling" | "json-fallback"
  ): AgentLLMMessage[] {
    return mode === "tool-calling" ? this.messages : this.jsonMessages
  }

  public async buildPageStateContext(
    session: AgentBrowserSession
  ): Promise<string> {
    const { accessibilityTree, elements, pageText, pageUrl } =
      await getPageContext(session.activeTabId)
    const elementsText = formatElementsForLLM(elements)
    const workspaceTabs = await getWorkspaceTabs(session)
    const workspaceText = formatWorkspaceForLLM(workspaceTabs)

    const hasTree = accessibilityTree.length > 0

    return this.visionMode
      ? [
          `Current active tab: ${pageUrl}`,
          `Root tab id: ${session.rootTabId}`,
          `=== WORKSPACE TABS ===\n${workspaceText}`,
          `Current page: ${pageUrl}`,
          "You are operating in VISION MODE. The user has provided a screenshot of the page.",
          "Interactive elements are marked with a red square containing an ID number.",
          `Use these IDs (e.g. ref_1, ref_2) when calling click_element.`,
          hasTree
            ? `=== PAGE ACCESSIBILITY TREE ===\n${accessibilityTree}`
            : `=== INTERACTIVE ELEMENTS ===\n${elementsText}`
        ].join("\n")
      : [
          `Current active tab: ${pageUrl}`,
          `Root tab id: ${session.rootTabId}`,
          `=== WORKSPACE TABS ===\n${workspaceText}`,
          `Current page: ${pageUrl}`,
          "",
          hasTree
            ? `=== PAGE ACCESSIBILITY TREE ===\nElements have [ref_id] identifiers. Use these IDs with click_element, fill_input, hover_element.\n${accessibilityTree}`
            : `=== INTERACTIVE ELEMENTS ===\n${elementsText}`,
          pageText
            ? `\n=== PAGE CONTENT (first 2000 chars) ===\n${pageText}`
            : ""
        ]
          .filter(Boolean)
          .join("\n")
  }

  /**
   * Replaces older full-page states in history with brief summaries to prevent context bloat.
   * This operates on the in-place message arrays.
   */
  private pruneOldContexts() {
    ;[this.messages, this.jsonMessages].forEach((msgArray) => {
      // Find all user messages that contain "Here is the current page state:" or "Here is the updated page state:"
      const statePrefixRegex =
        /(Here is the current page state:\n|Here is the updated page state:\n)[\s\S]+/

      // We want to keep the LAST state message fully intact, but prune all previous ones.
      let lastStateMsgIndex = -1
      for (let i = msgArray.length - 1; i >= 0; i--) {
        if (
          msgArray[i].role === "user" &&
          statePrefixRegex.test(msgArray[i].content)
        ) {
          lastStateMsgIndex = i
          break
        }
      }

      if (lastStateMsgIndex > -1) {
        // Prune older ones
        for (let i = 0; i < lastStateMsgIndex; i++) {
          if (
            msgArray[i].role === "user" &&
            statePrefixRegex.test(msgArray[i].content)
          ) {
            msgArray[i].content = msgArray[i].content.replace(
              statePrefixRegex,
              "[Page state omitted for brevity. See latest message for current state.]"
            )
            // Also strip images from old user messages to save memory
            msgArray[i].images = undefined
          }
        }
      }
    })
  }

  public async refreshContext(
    session: AgentBrowserSession,
    options: { reset?: boolean; reason?: string } = {}
  ) {
    const initialContext = await this.buildPageStateContext(session)

    if (options.reset) {
      this.messages = [
        { role: "system", content: AGENT_SYSTEM_PROMPT },
        {
          role: "user",
          content: `Task: ${this.task}\n\nHere is the current page state:\n${initialContext}`
        }
      ]

      this.jsonMessages = [
        { role: "system", content: JSON_AGENT_SYSTEM_PROMPT },
        {
          role: "user",
          content: `Task: ${this.task}\n\nHere is the current page state:\n${initialContext}`
        }
      ]
      return
    }

    const reasonPrefix = options.reason ? `${options.reason}\n\n` : ""
    const updateContent = `${reasonPrefix}Here is the updated page state:\n${initialContext}`

    this.messages.push({
      role: "user",
      content: updateContent
    })

    this.jsonMessages.push({
      role: "user",
      content: `${updateContent}\n\nRespond with ONLY a JSON object.`
    })

    // CRITICAL: Prune older contexts so we don't drop the connection when using local models!
    this.pruneOldContexts()
  }

  public addAssistantMessage(
    msg: AgentLLMMessage,
    mode: "tool-calling" | "json-fallback"
  ) {
    if (mode === "tool-calling") {
      this.messages.push(msg)
    } else {
      this.jsonMessages.push(msg)
    }
  }

  public addUserMessage(
    content: string,
    mode: "tool-calling" | "json-fallback"
  ) {
    if (mode === "tool-calling") {
      this.messages.push({ role: "user", content })
    } else {
      this.jsonMessages.push({ role: "user", content })
    }
  }

  public addToolMessage(toolCallId: string, name: string, content: string) {
    this.messages.push({
      role: "tool",
      tool_call_id: toolCallId,
      name,
      content
    })
  }

  public attachImageToLastUserMessage(base64Image: string) {
    // Reverse find the last user message
    for (let i = this.messages.length - 1; i >= 0; i--) {
      if (this.messages[i].role === "user") {
        this.messages[i].images = [base64Image]
        break
      }
    }
    for (let i = this.jsonMessages.length - 1; i >= 0; i--) {
      if (this.jsonMessages[i].role === "user") {
        this.jsonMessages[i].images = [base64Image]
        break
      }
    }
  }

  /** Gets stripped messages for LLM request payload */
  public getPayloadMessages(
    mode: "tool-calling" | "json-fallback"
  ): AgentLLMMessage[] {
    const msgs = this.getMessages(mode)
    return msgs.map((m) => ({
      ...m,
      images: m.images ? [...m.images] : undefined
    }))
  }
}
