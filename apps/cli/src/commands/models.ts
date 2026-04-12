import { listModels, RuntimeContext, runModelOperation } from "@olc/core"
import type { Command } from "commander"

export const runModelsCommand = (program: Command) => {
  const models = program.command("models").description("Model operations")

  models
    .command("list")
    .description("List models")
    .option("--provider <id>", "Provider ID")
    .action(async (opts: { provider?: string }) => {
      const runtime = new RuntimeContext()
      const items = await listModels(runtime, opts.provider)
      for (const item of items) {
        process.stdout.write(
          `${item.id}\tprovider=${item.providerId}\tname=${item.providerName}\n`
        )
      }
    })

  const makeAction =
    (operation: "pull" | "unload" | "delete") =>
    async (model: string, opts: { provider: string }) => {
      const runtime = new RuntimeContext()
      await runModelOperation(runtime, operation, model, opts.provider)
      process.stdout.write(
        `Model ${operation} succeeded for "${model}" on provider "${opts.provider}".\n`
      )
    }

  models
    .command("pull <model>")
    .description("Pull/download a model")
    .requiredOption("--provider <id>", "Provider ID")
    .action(makeAction("pull"))

  models
    .command("unload <model>")
    .description("Unload a model")
    .requiredOption("--provider <id>", "Provider ID")
    .action(makeAction("unload"))

  models
    .command("delete <model>")
    .description("Delete a model")
    .requiredOption("--provider <id>", "Provider ID")
    .action(makeAction("delete"))
}
