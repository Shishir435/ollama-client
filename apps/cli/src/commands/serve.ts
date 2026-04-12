import { RuntimeContext, startOpenAIServer } from "@olc/core"

export const runServeCommand = async (host: string, port: number) => {
  const runtime = new RuntimeContext()
  const server = await startOpenAIServer({
    host,
    port,
    runtime
  })

  process.stdout.write(`OLC server listening at ${server.url}\n`)
  process.stdout.write(
    "Endpoints: GET /healthz, GET /v1/models, POST /v1/chat/completions\n"
  )

  const close = async () => {
    await server.close()
    process.stdout.write("Server stopped.\n")
    process.exit(0)
  }

  process.on("SIGINT", () => void close())
  process.on("SIGTERM", () => void close())
}
