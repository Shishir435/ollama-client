export const runPromptCommand = async (prompt: string) => {
  const output = prompt.trim().length
    ? `You said: ${prompt}`
    : "Please provide a prompt."

  process.stdout.write(`${output}\n`)
}
