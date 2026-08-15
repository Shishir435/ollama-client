import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/protocol/extension-client", () => ({
  extensionRpcClient: { call: vi.fn() }
}))

vi.mock("@/features/model/hooks/use-provider-models", () => ({
  useProviderModels: () => ({
    selectedProviderCapabilities: { modelUnload: true },
    selectedProviderId: "ollama"
  })
}))

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))

import { RpcMethod } from "@ollama-client/contracts/rpc"
import { extensionRpcClient } from "@/protocol/extension-client"

import { LoadedModelsInfo } from "../loaded-models-info"

const mockedCall = vi.mocked(extensionRpcClient.call)

const model = (name: string) => ({
  name,
  family: "llama",
  sizeBytes: 1000,
  parameterSize: "8B",
  quantizationLevel: "Q4"
})

const deferred = <T,>() => {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

/** Model rows live inside the collapsible, which starts closed. */
const expandPanel = () => {
  fireEvent.click(screen.getByText("settings.loaded_models.title"))
}

beforeEach(() => {
  mockedCall.mockReset()
})

describe("LoadedModelsInfo concurrent fetches", () => {
  /**
   * A visibility change, an interval tick and a manual refresh each issue their
   * own request. If a slow earlier one is allowed to write state it overwrites
   * the newer list.
   */
  it("ignores a stale response that settles after a newer one", async () => {
    const first = deferred<{ models: ReturnType<typeof model>[] }>()
    const second = deferred<{ models: ReturnType<typeof model>[] }>()

    mockedCall
      .mockReturnValueOnce(first.promise as never)
      .mockReturnValueOnce(second.promise as never)

    render(<LoadedModelsInfo />)
    expandPanel()

    // Second request starts and settles first.
    document.dispatchEvent(new Event("visibilitychange"))
    await waitFor(() => {
      expect(mockedCall).toHaveBeenCalledTimes(2)
    })

    second.resolve({ models: [model("current-model")] })
    await waitFor(() => {
      expect(screen.getByText("current-model")).toBeInTheDocument()
    })

    // The earlier request now settles with an older list.
    first.resolve({ models: [model("stale-model")] })
    await waitFor(() => {
      expect(screen.queryByText("stale-model")).not.toBeInTheDocument()
    })
    expect(screen.getByText("current-model")).toBeInTheDocument()
  })

  it("does not reintroduce a model that was just unloaded", async () => {
    const inFlight = deferred<{ models: ReturnType<typeof model>[] }>()

    mockedCall.mockReturnValueOnce({
      models: [model("gone-model")]
    } as never)

    render(<LoadedModelsInfo />)
    expandPanel()
    await waitFor(() => {
      expect(screen.getByText("gone-model")).toBeInTheDocument()
    })

    // A refresh is in flight when the unload completes.
    mockedCall.mockReturnValueOnce(inFlight.promise as never)
    document.dispatchEvent(new Event("visibilitychange"))
    await waitFor(() => {
      expect(mockedCall).toHaveBeenCalledTimes(2)
    })

    mockedCall.mockResolvedValueOnce({ unloaded: true } as never)
    fireEvent.click(
      screen.getByLabelText("settings.loaded_models.unload_tooltip")
    )

    await waitFor(() => {
      expect(mockedCall).toHaveBeenCalledWith(
        RpcMethod.ModelsUnload,
        expect.objectContaining({ model: "gone-model" })
      )
    })

    inFlight.resolve({ models: [model("gone-model")] })

    await waitFor(() => {
      expect(screen.queryByText("gone-model")).not.toBeInTheDocument()
    })
  })
})
