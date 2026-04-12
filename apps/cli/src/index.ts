#!/usr/bin/env node
import { Command } from "commander"
import { runAgentCommand } from "./commands/agent"
import { runDoctorCommand } from "./commands/doctor"
import { runModelsCommand } from "./commands/models"
import { runPromptCommand } from "./commands/run"
import { runServeCommand } from "./commands/serve"

const program = new Command()

program.name("olc").description("Ollama Client CLI and local gateway server")

program
  .command("chat")
  .description("Start interactive chat (TUI)")
  .requiredOption("-m, --model <id>", "Model ID")
  .option("--provider <id>", "Preferred provider ID")
  .action(async (opts: { model: string; provider?: string }) => {
    const { runChatCommand } = await import("./commands/chat")
    await runChatCommand(opts.model, opts.provider)
  })

program
  .command("run")
  .description("Run a single prompt")
  .requiredOption("-p, --prompt <text>", "Prompt text")
  .requiredOption("-m, --model <id>", "Model ID")
  .option("--provider <id>", "Preferred provider ID")
  .action(
    async (opts: { prompt: string; model: string; provider?: string }) => {
      await runPromptCommand(opts.prompt, opts.model, opts.provider)
    }
  )

program
  .command("serve")
  .description("Start OpenAI-compatible local server")
  .option("--host <host>", "Host", "127.0.0.1")
  .option("--port <port>", "Port", "11435")
  .action(async (opts: { host: string; port: string }) => {
    await runServeCommand(opts.host, Number(opts.port))
  })

runModelsCommand(program)

program
  .command("doctor")
  .description("Check config and provider health")
  .action(async () => {
    await runDoctorCommand()
  })

program
  .command("agent")
  .description("Supervised autonomous runtime")
  .command("run")
  .description("Plan + confirm + execute a supervised task")
  .requiredOption("-t, --task <task>", "Task prompt")
  .action(async (opts: { task: string }) => {
    await runAgentCommand(opts.task)
  })

program.action(async () => {
  program.help()
})

program.parseAsync(process.argv).catch((error) => {
  const message = error instanceof Error ? error.message : String(error)
  process.stderr.write(`${message}\n`)
  process.exit(1)
})
