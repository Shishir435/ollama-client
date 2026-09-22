import { beforeEach, describe, expect, it, vi } from "vitest"
import type { AgentModelCompatibility } from "@/application/agent/agent-model-compatibility"

const storageListeners = new Set<(changes: Record<string, unknown>) => void>()

vi.mock("@/lib/browser-api", () => ({
  browser: {
    storage: {
      onChanged: {
        addListener: (listener: (changes: Record<string, unknown>) => void) => {
          storageListeners.add(listener)
        }
      }
    }
  }
}))

const getProviderConfig = vi.fn(async () => ({
  name: "Local",
  baseUrl: "http://localhost:11434"
}))

vi.mock("@/lib/providers/manager", () => ({
  ProviderManager: { getProviderConfig: () => getProviderConfig() }
}))

vi.mock("@/lib/providers/base-url", () => ({
  resolveProviderBaseUrl: (config: { baseUrl: string }) => config.baseUrl
}))

const discoveredModels = vi.fn(() => [] as unknown[])

vi.mock("@/lib/providers/factory", () => ({
  ProviderFactory: { getProvider: async () => ({ id: "ollama" }) }
}))

vi.mock("@/lib/providers/model-discovery", () => ({
  discoverProviderModels: async () => ({ models: discoveredModels() })
}))

const { resolveAgentProviderDisclosure } = await import(
  "../agent-provider-disclosure"
)

const ready: AgentModelCompatibility = {
  status: "supported",
  mode: "native",
  reason: "metadata",
  vision: true
}

const notify = (key: string) => {
  for (const listener of storageListeners) listener({ [key]: { newValue: 1 } })
}

beforeEach(() => {
  discoveredModels.mockReturnValue([])
  notify("provider-model-capability-overrides")
})

describe("resolveAgentProviderDisclosure", () => {
  it("states a verdict when the lookup itself failed", async () => {
    /*
     * A provider with no verdict was read by the Start gate as one still
     * resolving, so an unreachable provider started a run, attached to a tab,
     * and was refused at planning time.
     */
    const disclosure = await resolveAgentProviderDisclosure("ollama", "qwen3", {
      resolveCompatibility: async () => {
        throw new Error("provider unreachable")
      }
    })

    expect(disclosure?.readiness).toEqual({
      status: "unsupported",
      reason: "unknown",
      vision: "unknown"
    })
    expect(disclosure?.screenshots).toBeUndefined()
  })

  it("asks again after a failure rather than remembering it", async () => {
    const resolveCompatibility = vi
      .fn<() => Promise<AgentModelCompatibility>>()
      .mockRejectedValueOnce(new Error("provider unreachable"))
      .mockResolvedValue(ready)

    await resolveAgentProviderDisclosure("ollama", "qwen3", {
      resolveCompatibility
    })
    const second = await resolveAgentProviderDisclosure("ollama", "qwen3", {
      resolveCompatibility
    })

    expect(second?.readiness?.status).toBe("ready")
    expect(resolveCompatibility).toHaveBeenCalledTimes(2)
  })

  it("re-resolves a settled verdict once its evidence changes", async () => {
    /*
     * This cache gates a button. A remembered "ready" that the run would now
     * refuse puts the refusal back after the browser has attached, which is
     * what the readiness gate exists to remove.
     */
    const resolveCompatibility = vi
      .fn<() => Promise<AgentModelCompatibility>>()
      .mockResolvedValue(ready)

    await resolveAgentProviderDisclosure("ollama", "qwen3", {
      resolveCompatibility
    })
    await resolveAgentProviderDisclosure("ollama", "qwen3", {
      resolveCompatibility
    })
    expect(resolveCompatibility).toHaveBeenCalledTimes(1)

    notify("provider-model-capability-probes")
    await resolveAgentProviderDisclosure("ollama", "qwen3", {
      resolveCompatibility
    })
    expect(resolveCompatibility).toHaveBeenCalledTimes(2)
  })

  it("re-resolves alternatives for a provider that never settled", async () => {
    /*
     * The watcher hung off the settled-compatibility write, so a provider
     * whose only disclosed model was unsupported cached its alternatives with
     * nobody watching: a model uninstalled afterwards stayed on the refusal
     * card, and a newly installed one never reached it.
     *
     * Loaded fresh, because registration is once per module: a test running
     * after one that settled a verdict would find the listener already there
     * and pass against the bug it is here to catch.
     */
    vi.resetModules()
    storageListeners.clear()
    const { resolveAgentProviderDisclosure: freshResolve } = await import(
      "../agent-provider-disclosure"
    )
    const unsupported = async () =>
      ({ status: "unsupported", reason: "reported_unsupported" }) as const

    discoveredModels.mockReturnValue([
      { name: "was-here", capabilityHints: { supportedParameters: ["tools"] } }
    ])
    const first = await freshResolve("ollama", "qwen3", {
      resolveCompatibility: unsupported
    })
    expect(first?.readiness?.alternatives).toEqual(["was-here"])

    discoveredModels.mockReturnValue([
      {
        name: "installed-since",
        capabilityHints: { supportedParameters: ["tools"] }
      }
    ])
    notify("provider-model-catalog-support")
    const second = await freshResolve("ollama", "qwen3", {
      resolveCompatibility: unsupported
    })

    expect(second?.readiness?.alternatives).toEqual(["installed-since"])
  })

  it("suggests only models whose own catalog reports tool calling", async () => {
    /*
     * Ollama's `/api/tags` rows carry no capability hints, so a status alone
     * resolves from the provider default and would list every installed model
     * as an alternative — sending a refused user to another model that cannot
     * call tools either.
     */
    discoveredModels.mockReturnValue([
      { name: "no-hints" },
      {
        name: "states-tools",
        capabilityHints: { supportedParameters: ["tools"] }
      }
    ])

    const disclosure = await resolveAgentProviderDisclosure("ollama", "qwen3", {
      resolveCompatibility: async () => ({
        status: "unsupported",
        reason: "reported_unsupported",
        vision: false
      })
    })

    expect(disclosure?.readiness?.alternatives).toEqual(["states-tools"])
  })
})
