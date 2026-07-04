export type AgentRunStatus =
  | "running"
  | "awaiting-approval"
  | "paused"
  | "completed"
  | "failed"
  | "cancelled"
  | "capped"

export type AgentPageAction = "click" | "type" | "select"

export interface PageElementRef {
  elementId: number
  role: string
  name: string
  tag: string
  type?: string
  value?: string
  disabled: boolean
  checked?: boolean
  selected?: boolean
  inViewport: boolean
  framePath?: number[]
}

export interface PageSnapshot {
  snapshotId: string
  documentId: string
  url: string
  title: string
  capturedAt: number
  elements: PageElementRef[]
  truncated: number
  unsupportedCrossOriginFrames: number
}

export interface AgentElementTarget {
  snapshotId: string
  elementId: number
}

export interface AgentPageActionRequest extends AgentElementTarget {
  action: AgentPageAction
  text?: string
  value?: string
}

export interface AgentStep {
  id: string
  kind: "observe" | "navigate" | "act" | "system"
  label: string
  status: "running" | "awaiting-approval" | "done" | "error"
  origin?: string
  startedAt: number
  completedAt?: number
  result?: string
}

export interface AgentRunState {
  task: string
  targetTabId: number
  targetUrl?: string
  allowedOrigins: string[]
  lastSnapshot?: PageSnapshot
  steps: AgentStep[]
  pendingAction?: Omit<AgentPageActionRequest, "text"> & {
    textLength?: number
  }
  modelTurns: number
  actionCount: number
  activeMs: number
}
