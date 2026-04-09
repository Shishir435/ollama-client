export interface InteractiveElement {
  id: number | string
  type: "button" | "link" | "input" | "select" | "textarea" | "other"
  text: string
  placeholder?: string
  href?: string
  value?: string
  visible: boolean
  disabled?: boolean
  options?: string[] // for <select>
}

export interface AgentToolCall {
  name: string
  arguments: Record<string, unknown>
}

export type AgentActionType =
  | "get_interactive_elements"
  | "click_element"
  | "fill_input"
  | "select_option"
  | "scroll_page"
  | "navigate_to"
  | "get_page_content"
  | "wait"
  | "task_complete"
  | "get_video_status"
  | "control_video"
  | "wait_for_video_end"
  | "advance_to_next_video"
  | "execute_js"
  | "press_key"
  | "plan"
  | "hover_element"
  | "open_link_in_new_tab"
  | "open_url_in_new_tab"
  | "switch_to_tab"
  | "list_tabs"
  | "close_tab"
  | "return_to_root_tab"
  | "copy_current_url"
  | "copy_link_url"
  | "copy_page_text"
  | "download_url"
  | "download_link"

export interface AgentAction {
  type: AgentActionType
  element_id?: number | string
  value?: string
  direction?: "up" | "down"
  url?: string
  ms?: number
  message?: string
  code?: string      // for execute_js
  key?: string       // for press_key
  text?: string      // for plan
  state?: "play" | "pause" | "toggle"
  tab_id?: number
  tab_index?: number
  background?: boolean
  filename?: string
}

export interface AgentActionResult {
  success: boolean
  message: string
  data?: unknown
}

export type AgentStatus =
  | "idle"
  | "running"
  | "waiting_for_action"
  | "done"
  | "error"
  | "stopped"

export type AgentWaitContext = "video_playback"

export interface AgentStep {
  stepNumber: number
  thought?: string
  action?: AgentAction
  result?: AgentActionResult
  timestamp: number
}

export interface AgentTaskMessage {
  type: string
  payload: {
    task: string
    model: string
    providerId?: string
    tabId?: number
    maxSteps?: number
    visionMode?: boolean
    autoRepeat?: boolean
  }
}

export interface AgentStreamMessage {
  type: "step" | "done" | "error" | "status"
  step?: AgentStep
  status?: AgentStatus
  message?: string
  heartbeat?: boolean
  waitContext?: AgentWaitContext
  error?: string
  totalSteps?: number
  elapsedMs?: number
  /** Which mode the agent is using */
  mode?: "tool-calling" | "json-fallback"
}
