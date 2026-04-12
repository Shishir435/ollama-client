import { stdin, stdout } from "node:process"
import { createInterface } from "node:readline/promises"
import { createSupervisedPlan, executeSupervisedTask } from "@olc/core"

const askForConfirmation = async () => {
  const rl = createInterface({ input: stdin, output: stdout })
  try {
    const answer = await rl.question("Approve supervised execution? (y/N): ")
    return answer.trim().toLowerCase() === "y"
  } finally {
    rl.close()
  }
}

export const runAgentCommand = async (task: string) => {
  const plan = createSupervisedPlan(task)
  process.stdout.write(`Plan: ${plan.summary}\n`)
  for (const step of plan.steps) {
    process.stdout.write(`- ${step}\n`)
  }

  if (plan.requiresConfirmation) {
    const confirmed = await askForConfirmation()
    if (!confirmed) {
      process.stdout.write("Execution cancelled by user.\n")
      return
    }
  }

  const result = await executeSupervisedTask(task)
  process.stdout.write("Execution logs:\n")
  for (const entry of result.logs) {
    const details = entry.details ? JSON.stringify(entry.details) : ""
    process.stdout.write(
      `${entry.time}\t${entry.level}\t${entry.action}\t${details}\n`
    )
  }
}
