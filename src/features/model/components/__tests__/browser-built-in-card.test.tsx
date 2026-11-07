import { RpcMethod } from "@ollama-client/contracts/rpc"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { BrowserBuiltInCard } from "../browser-built-in-card"

const mocks = vi.hoisted(() => ({
  api: vi.fn(),
  create: vi.fn(),
  call: vi.fn()
}))
vi.mock("@/lib/providers/browser-built-in/api", () => ({
  promptAPI: mocks.api,
  createPromptSession: mocks.create,
  TEXT_OPTIONS: {
    expectedInputs: [{ type: "text" }],
    expectedOutputs: [{ type: "text" }]
  }
}))
vi.mock("@/protocol/extension-client", () => ({
  extensionRpcClient: { call: mocks.call }
}))
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))

const key = (name: string) => `settings.providers.browser_builtin.${name}`
const mount = () =>
  render(
    <QueryClientProvider client={new QueryClient()}>
      <BrowserBuiltInCard />
    </QueryClientProvider>
  )
const deferred = <T,>() => {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

/** What the host holds: a status read reports it, and enabling changes it. */
const host = { enabled: false }
const hostCall = async (method: RpcMethod) => {
  if (method === RpcMethod.BrowserModelStatus)
    return { availability: "available", enabled: host.enabled }
  host.enabled = true
  return { provider: { enabled: true } }
}

beforeEach(() => {
  host.enabled = false
  mocks.api.mockReturnValue({})
  mocks.call.mockImplementation(hostCall)
  mocks.create.mockResolvedValue({ promptStreaming: vi.fn(), destroy: vi.fn() })
})
afterEach(() => {
  vi.useRealTimers()
  vi.resetAllMocks()
})

describe("browser built-in opt-in", () => {
  it("does not mount or call RPC without the API, even without a query context", () => {
    mocks.api.mockReturnValue(undefined)
    const { container } = render(<BrowserBuiltInCard />)
    expect(container).toBeEmptyDOMElement()
    expect(mocks.call).not.toHaveBeenCalled()
  })

  it("hides an exposed API when the host reports unavailable", async () => {
    mocks.call.mockResolvedValue({
      availability: "unavailable",
      enabled: false
    })
    const { container } = mount()
    await waitFor(() => expect(mocks.call).toHaveBeenCalled())
    expect(container).toBeEmptyDOMElement()
  })

  it("destroys the preparation session before enabling through the background", async () => {
    const destroy = vi.fn()
    mocks.create.mockResolvedValue({ promptStreaming: vi.fn(), destroy })
    mount()
    fireEvent.click(await screen.findByRole("button", { name: key("enable") }))
    await screen.findByRole("button", { name: key("disable") })
    expect(destroy).toHaveBeenCalledOnce()
    expect(mocks.call).toHaveBeenCalledWith(
      RpcMethod.ProvidersSetEnabled,
      { providerId: "browser-built-in", enabled: true },
      { signal: expect.any(AbortSignal) }
    )
    expect(destroy.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.call.mock.invocationCallOrder[1]
    )
  })

  it("cancels preparation without enabling or showing a failure", async () => {
    mocks.create.mockImplementation(
      ({ signal }: { signal: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(signal.reason), {
            once: true
          })
        })
    )
    mount()
    fireEvent.click(await screen.findByRole("button", { name: key("enable") }))
    fireEvent.click(
      await screen.findByRole("button", { name: "common.cancel" })
    )
    await waitFor(() =>
      expect(
        screen.queryByRole("button", { name: "common.cancel" })
      ).not.toBeInTheDocument()
    )
    expect(mocks.call).not.toHaveBeenCalledWith(
      RpcMethod.ProvidersSetEnabled,
      expect.anything(),
      expect.anything()
    )
    expect(screen.queryByRole("alert")).not.toBeInTheDocument()
  })

  it("ignores a stale status reply after enable has committed", async () => {
    vi.useFakeTimers()
    mount()
    await act(async () => {
      await Promise.resolve()
    })
    const enable = screen.getByRole("button", { name: key("enable") })
    const stale = deferred<{ availability: string; enabled: boolean }>()
    // Only the read already in flight is stale; the one after the change is fresh.
    mocks.call.mockImplementationOnce(() => stale.promise)
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"))
    })
    expect(mocks.call).toHaveBeenCalledTimes(2)
    await act(async () => {
      fireEvent.click(enable)
    })
    await act(async () => {
      stale.resolve({ availability: "available", enabled: false })
      await stale.promise
    })
    expect(
      screen.getByRole("button", { name: key("disable") })
    ).toBeInTheDocument()
  })

  it("keeps a failed preparation disabled", async () => {
    mocks.create.mockRejectedValue(
      new DOMException("Private native detail", "NotSupportedError")
    )
    mount()
    fireEvent.click(await screen.findByRole("button", { name: key("enable") }))
    expect(await screen.findByRole("alert")).toHaveTextContent(key("failed"))
    expect(screen.queryByText("Private native detail")).not.toBeInTheDocument()
    expect(mocks.call).not.toHaveBeenCalledWith(
      RpcMethod.ProvidersSetEnabled,
      expect.anything(),
      expect.anything()
    )
  })

  it("re-reads the status after a change settles, without a standing poll", async () => {
    mount()
    fireEvent.click(await screen.findByRole("button", { name: key("enable") }))
    await screen.findByRole("button", { name: key("disable") })
    const reads = () =>
      mocks.call.mock.calls.filter(
        ([method]) => method === RpcMethod.BrowserModelStatus
      ).length
    expect(reads()).toBeGreaterThanOrEqual(2)
    const settled = reads()
    vi.useFakeTimers()
    await act(() => vi.advanceTimersByTimeAsync(60_000))
    expect(reads()).toBe(settled)
  })
})
