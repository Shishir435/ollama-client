#!/usr/bin/env node
import { Command } from "commander"
import { runChatCommand } from "./commands/chat"
import { runPromptCommand } from "./commands/run"

const program = new Command()

program
  .name("olc")
  .description("Ollama Client CLI")
  .option("--repl", "Start interactive chat")
  .option("-p, --prompt <text>", "Run a single prompt")

program
  .command("chat")
  .description("Start interactive chat (Ink)")
  .action(async () => {
    await runChatCommand()
  })

program
  .command("run")
  .description("Run a single prompt")
  .requiredOption("-p, --prompt <text>", "Prompt text")
  .action(async (opts: { prompt: string }) => {
    await runPromptCommand(opts.prompt)
  })

program.action(async () => {
  const opts = program.opts<{ repl?: boolean; prompt?: string }>()

  if (opts.prompt) {
    await runPromptCommand(opts.prompt)
    return
  }

  if (opts.repl) {
    await runChatCommand()
    return
  }

  program.help()
})

program.parseAsync(process.argv)
