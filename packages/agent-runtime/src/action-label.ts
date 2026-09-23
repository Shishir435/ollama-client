import type { AgentCommand, AgentDisplayText } from "@ollama-client/contracts"

/** The display schema's bound on one interpolated value. */
const MAX_DISPLAY_VALUE_CHARS = 2_048

const bounded = (value: string): string =>
  value.slice(0, MAX_DISPLAY_VALUE_CHARS)

/**
 * How a command reads to a person, as an i18n key and the values it needs.
 *
 * One mapping for every surface that names a command — the work log, the
 * line above it, and the approval that asks for it — so an approval cannot
 * call an effect something the log later calls something else. Exhaustive
 * over the command union: a command added to the contract without a label
 * is a typecheck failure here, not a raw key path on screen.
 *
 * Page-derived values travel unflattened and bounded; the panel flattens
 * every value it interpolates, because only it knows it is about to render.
 */
export const agentCommandDisplay = (
  command?: AgentCommand
): AgentDisplayText => {
  if (!command) return { key: "agent.action.step" }
  switch (command.type) {
    case "navigate":
    case "open_tab":
      return {
        key: `agent.action.${command.type}`,
        values: { url: bounded(command.url) }
      }
    case "scroll":
      return { key: `agent.action.scroll_${command.direction}` }
    case "switch_tab":
      return { key: "agent.action.switch_tab", values: { tab: command.tabId } }
    case "wait":
      return {
        key: "agent.action.wait",
        values: { condition: bounded(command.condition) }
      }
    case "press_key":
      return {
        key: "agent.action.press_key",
        values: { key: bounded(command.key) }
      }
    case "inspect":
      return {
        key: "agent.action.inspect",
        values: { region: bounded(command.target) }
      }
    case "find":
      return {
        key: "agent.action.find",
        values: { query: bounded(command.query) }
      }
    case "handle_dialog":
      return {
        key: command.accept
          ? "agent.action.handle_dialog_accept"
          : "agent.action.handle_dialog_dismiss"
      }
    case "fill_form":
      return {
        key: "agent.action.fill_form",
        values: { count: command.fields.length }
      }
    case "extract":
      return {
        key: "agent.action.extract",
        values: { count: command.queries.length }
      }
    case "call_page_tool":
      return {
        key: "agent.action.call_page_tool",
        values: { tool: bounded(command.toolName) }
      }
    case "read":
    case "back":
    case "forward":
    case "click":
    case "double_click":
    case "click_point":
    case "zoom":
    case "hover":
    case "type":
    case "clear_and_type":
    case "replace_text":
    case "select":
    case "check":
    case "uncheck":
    case "drag":
    case "extract_text":
      return { key: `agent.action.${command.type}` }
  }
}
