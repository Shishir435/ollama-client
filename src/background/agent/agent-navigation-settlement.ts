import type { AgentCancellationSignal } from "@ollama-client/agent-runtime"

/** Observe navigation settling; never dispatch or retry a browser effect. */
export const waitForAgentNavigation = async (input: {
  tabId: number
  sourceUrl: string
  destinationUrl: string
  signal: AgentCancellationSignal
  getTab(tabId: number): Promise<{ url?: string; status?: string } | undefined>
  timeoutMs?: number
}): Promise<void> => {
  const deadline = Date.now() + (input.timeoutMs ?? 10_000)
  while (true) {
    if (input.signal.aborted) throw new Error("Agent navigation wait cancelled")
    const tab = await input.getTab(input.tabId)
    if (!tab) return
    if (
      tab.status !== "loading" &&
      (tab.url === input.destinationUrl ||
        (tab.url && tab.url !== input.sourceUrl))
    )
      return
    const remaining = deadline - Date.now()
    if (remaining <= 0) throw new Error("Agent navigation did not settle")
    await new Promise<void>((resolve, reject) => {
      const abort = () => {
        clearTimeout(timer)
        input.signal.removeEventListener?.("abort", abort)
        reject(new Error("Agent navigation wait cancelled"))
      }
      const timer = setTimeout(
        () => {
          input.signal.removeEventListener?.("abort", abort)
          resolve()
        },
        Math.min(100, remaining)
      )
      input.signal.addEventListener?.("abort", abort, { once: true })
      if (input.signal.aborted) abort()
    })
  }
}
