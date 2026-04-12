import { RuntimeContext, runChat } from "@olc/core"

export const runPromptCommand = async (
  prompt: string,
  model: string,
  providerId?: string
) => {
  if (!prompt.trim()) {
    process.stdout.write("Please provide a prompt.\n")
    return
  }

  const runtime = new RuntimeContext()
  const result = await runChat(runtime, {
    model,
    providerId,
    messages: [{ role: "user", content: prompt }]
  })

  process.stdout.write(`${result.text}\n`)
}
