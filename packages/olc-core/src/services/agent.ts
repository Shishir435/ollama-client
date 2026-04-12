import type { StructuredLogEntry } from "../types"

export type AgentPlan = {
  summary: string
  requiresConfirmation: boolean
  steps: string[]
}

export type AgentExecution = {
  plan: AgentPlan
  logs: StructuredLogEntry[]
}

const now = () => new Date().toISOString()

export const createSupervisedPlan = (task: string): AgentPlan => {
  return {
    summary: `Supervised execution for task: ${task}`,
    requiresConfirmation: true,
    steps: [
      "Interpret user intent and identify required provider operations",
      "Preview actions and request explicit confirmation",
      "Execute approved actions with structured logs",
      "Summarize outcome and next steps"
    ]
  }
}

export const executeSupervisedTask = async (
  task: string
): Promise<AgentExecution> => {
  const plan = createSupervisedPlan(task)
  const logs: StructuredLogEntry[] = [
    {
      time: now(),
      level: "info",
      action: "plan-created",
      details: { task, steps: plan.steps }
    },
    {
      time: now(),
      level: "info",
      action: "execution-started",
      details: { mode: "supervised" }
    },
    {
      time: now(),
      level: "info",
      action: "execution-finished",
      details: {
        outcome: "No side-effectful actions executed in core agent runtime."
      }
    }
  ]

  return { plan, logs }
}
