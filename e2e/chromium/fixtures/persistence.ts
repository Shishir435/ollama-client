import type { Page } from "@playwright/test"
import type { ExtensionSession } from "./extension"

export type VerifyCall = (
  method: string,
  ...args: unknown[]
) => Promise<unknown>

const pageCall =
  (page: Page): VerifyCall =>
  (method, ...args) =>
    page.evaluate(
      ([methodName, callArgs]) => {
        const api = (
          window as unknown as {
            __persistenceVerify: Record<
              string,
              (...values: unknown[]) => Promise<unknown>
            >
          }
        ).__persistenceVerify
        return api[methodName](...callArgs)
      },
      [method, args] as const
    )

export const openPersistenceVerifyPage = async (
  extension: ExtensionSession
): Promise<{ page: Page; call: VerifyCall }> => {
  const deadline = Date.now() + 30_000
  for (;;) {
    const page = await extension.context.newPage()
    try {
      await page.goto(
        `chrome-extension://${extension.extensionId}/persistence-verify.html`,
        { timeout: 10_000 }
      )
      await page.waitForFunction(
        () => document.getElementById("status")?.textContent === "hooks-ready",
        undefined,
        { timeout: 10_000 }
      )
      return { page, call: pageCall(page) }
    } catch (error) {
      await page.close().catch(() => {})
      if (Date.now() >= deadline) throw error
      await new Promise((resolvePause) => setTimeout(resolvePause, 500))
    }
  }
}

export const waitForOpfsMarker = async (
  call: VerifyCall,
  timeoutMs = 30_000
): Promise<{
  backend?: string
  sourceCounts?: { sessions?: number; messages?: number }
}> => {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const marker = (await call("backendMarker")) as {
      backend?: string
      sourceCounts?: { sessions?: number; messages?: number }
    } | null
    if (marker?.backend === "opfs") return marker
    if (Date.now() >= deadline) {
      throw new Error(
        `Backend marker never became opfs: ${JSON.stringify(marker)}`
      )
    }
    await new Promise((resolvePause) => setTimeout(resolvePause, 250))
  }
}
