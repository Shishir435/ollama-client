/** Observe an adopted Ollama server without acquiring authority to stop it. */
import { setTimeout as delay } from "node:timers/promises"
import { probeOllama } from "./runner.js"

/** Ctrl-C exits only this observer; app/service ownership remains unchanged. */
export async function monitorOllama(
  url: string,
  origins: string[],
  debug: boolean
): Promise<number> {
  console.error(
    "Attached to existing/app-managed Ollama. Ctrl-C exits this monitor; the server keeps running. Server logs remain with its app/service."
  )
  const abort = new AbortController()
  let exitCode = 0
  const interrupt = () => {
    exitCode = 130
    abort.abort()
  }
  const terminate = () => {
    exitCode = 143
    abort.abort()
  }
  process.once("SIGINT", interrupt)
  process.once("SIGTERM", terminate)
  try {
    while (!abort.signal.aborted) {
      await delay(5000, undefined, { signal: abort.signal })
      if (abort.signal.aborted) break
      if (!(await probeOllama(url, origins)).ready) {
        if (abort.signal.aborted) break
        console.error(
          "Ollama is no longer ready; exiting the foreground monitor."
        )
        return 1
      }
      if (debug && !abort.signal.aborted)
        console.error(`[Ollama] ready at ${url}`)
    }
  } catch (error) {
    if (!abort.signal.aborted) throw error
  } finally {
    process.off("SIGINT", interrupt)
    process.off("SIGTERM", terminate)
  }
  return exitCode
}
