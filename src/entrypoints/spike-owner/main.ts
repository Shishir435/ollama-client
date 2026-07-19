import { browser } from "wxt/browser"
import {
  type OwnerOp,
  type OwnerRpcResponse,
  SPIKE_OWNER_CLOSE,
  SPIKE_OWNER_ENSURE,
  SPIKE_OWNER_RPC
} from "@/spike/opfs/owner-protocol"

// Section 9.4 spike phase 2: extension-page client of the single owner.
// Exposes window.__spikeOwner / window.__spikeOwnerControl for the Playwright
// gate runner; the buttons are for manual use.

const statusLine = document.getElementById("status") as HTMLParagraphElement
const output = document.getElementById("output") as HTMLPreElement

const setStatus = (message: string): void => {
  statusLine.textContent = message
}

const show = (value: unknown): void => {
  output.textContent = JSON.stringify(value, null, 2)
}

const RPC_TIMEOUT_MS = 30_000

const withTimeout = async <T>(work: Promise<T>): Promise<T> => {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error("Owner RPC timed out")),
          RPC_TIMEOUT_MS
        )
      })
    ])
  } finally {
    clearTimeout(timer)
  }
}

const ensureOwner = async (): Promise<void> => {
  const response = (await withTimeout(
    browser.runtime.sendMessage({ type: SPIKE_OWNER_ENSURE })
  )) as OwnerRpcResponse | undefined
  if (!response) throw new Error("Ensure-owner message dropped")
  if (!response.ok) throw new Error(response.error)
}

const ownerRpc = async (op: OwnerOp, payload?: unknown): Promise<unknown> => {
  await ensureOwner()
  const response = (await withTimeout(
    browser.runtime.sendMessage({ type: SPIKE_OWNER_RPC, op, payload })
  )) as OwnerRpcResponse | undefined
  if (!response) throw new Error("Owner RPC message dropped")
  if (!response.ok) throw new Error(response.error)
  return response.result
}

const closeOwner = async (): Promise<unknown> => {
  const response = (await withTimeout(
    browser.runtime.sendMessage({ type: SPIKE_OWNER_CLOSE })
  )) as OwnerRpcResponse | undefined
  if (!response) throw new Error("Close-owner message dropped")
  if (!response.ok) throw new Error(response.error)
  return response
}

declare global {
  interface Window {
    __spikeOwner: (op: OwnerOp, payload?: unknown) => Promise<unknown>
    __spikeOwnerControl: {
      ensure: () => Promise<void>
      close: () => Promise<unknown>
    }
  }
}

window.__spikeOwner = ownerRpc
window.__spikeOwnerControl = { ensure: ensureOwner, close: closeOwner }

const wire = (id: string, action: () => Promise<unknown>): void => {
  const button = document.getElementById(id) as HTMLButtonElement
  button.addEventListener("click", async () => {
    button.disabled = true
    setStatus(`Running ${id}…`)
    try {
      show(await action())
      setStatus("Done")
    } catch (error) {
      setStatus(`Failed: ${error instanceof Error ? error.message : error}`)
    } finally {
      button.disabled = false
    }
  })
}

wire("info", () => ownerRpc("ownerInfo"))
wire("append", () =>
  ownerRpc("append", { writer: "manual", seq: Date.now() % 100000 })
)
wire("counts", () => ownerRpc("counts"))
wire("kill-worker", () => ownerRpc("terminateWorker"))
wire("close-owner", () => closeOwner())
wire("reset", () => ownerRpc("reset"))
