import { afterEach, describe, expect, it } from "vitest"

import {
  devEntrypointsToStrip,
  publicWasmAssets,
  stripDevEntrypoints
} from "../wxt-hooks"
import { persistenceDefines, vite } from "../wxt-vite"

/*
 * These two functions decide what a store package contains and which
 * persistence owner the background entry registers. Both were previously
 * inline in wxt.config.ts with no coverage at all, and that is not a
 * hypothetical gap: PR #200 changed the owner gating so the spike host took the
 * production owner's slot in any benchmark build, which silently disabled
 * `pnpm verify:opfs-migration` for a whole release. The build still succeeded;
 * only a manual runner outside CI could notice, and it did not run.
 */

const CHROMIUM_STORE = { command: "build", browser: "chrome", benchmark: false }
const FIREFOX_STORE = { command: "build", browser: "firefox", benchmark: false }

describe("devEntrypointsToStrip", () => {
  it("keeps every dev-only page out of a store build", () => {
    expect(devEntrypointsToStrip(CHROMIUM_STORE)).toEqual([
      "benchmark",
      "spike-opfs",
      "spike-owner",
      "spike-owner-offscreen",
      "persistence-verify",
      "ingestion-processor"
    ])
  })

  it("also drops the Chromium-only owner document on Firefox", () => {
    const stripped = devEntrypointsToStrip(FIREFOX_STORE)

    expect(stripped).toContain("persistence-host")
    expect(stripped).not.toContain("ingestion-processor")
    // Firefox hosts the owner in its persistent background page, so shipping
    // the offscreen document would be dead weight in the package.
    expect(stripped).toContain("spike-owner-offscreen")
  })

  it("keeps the dev pages in a benchmark build", () => {
    const stripped = devEntrypointsToStrip({
      ...CHROMIUM_STORE,
      benchmark: true
    })

    expect(stripped).toEqual(["ingestion-processor"])
  })

  it("keeps them in a dev server run without any env var", () => {
    const stripped = devEntrypointsToStrip({
      command: "serve",
      browser: "chrome",
      benchmark: false
    })

    expect(stripped).toEqual(["ingestion-processor"])
  })

  it("keeps the Firefox owner-client page while dropping only the offscreen one", () => {
    const stripped = devEntrypointsToStrip({
      ...FIREFOX_STORE,
      benchmark: true
    })

    expect(stripped).not.toContain("spike-owner")
    expect(stripped).toContain("spike-owner-offscreen")
    expect(stripped).toContain("persistence-host")
    expect(stripped).not.toContain("ingestion-processor")
  })
})

describe("publicWasmAssets", () => {
  const destinations = (target: {
    command: string
    browser: string
    benchmark: boolean
  }) => publicWasmAssets(target).map((asset) => asset.relativeDest)

  it("ships only the official sqlite3.wasm in a store build", () => {
    for (const target of [CHROMIUM_STORE, FIREFOX_STORE]) {
      expect(destinations(target)).toEqual(["assets/sqlite3.wasm"])
    }
  })

  it("adds the sql.js binary to the builds that keep the measurement pages", () => {
    for (const target of [
      { ...CHROMIUM_STORE, benchmark: true },
      { command: "serve", browser: "chrome", benchmark: false },
      { command: "serve", browser: "firefox", benchmark: false }
    ]) {
      expect(destinations(target)).toEqual([
        "assets/sqlite3.wasm",
        "assets/sql-wasm.wasm"
      ])
    }
  })

  it("copies the sql.js binary from the devDependency, not a committed copy", () => {
    const [, sqlJs] = publicWasmAssets({ ...CHROMIUM_STORE, benchmark: true })

    expect(sqlJs.absoluteSrc).toMatch(
      /node_modules[\\/]sql\.js[\\/]dist[\\/]sql-wasm\.wasm$/
    )
  })
})

describe("persistenceDefines", () => {
  it("registers no spike owner in a store build", () => {
    for (const browser of ["chrome", "firefox"]) {
      const defines = persistenceDefines({ browser, spikeOwner: false })

      expect(defines.__SPIKE_OPFS_OWNER__).toBe("false")
      expect(defines.__SPIKE_OPFS_OWNER_MV2__).toBe("false")
    }
  })

  it("hands the slot to the spike host only under WXT_SPIKE_OWNER", () => {
    const chromium = persistenceDefines({ browser: "chrome", spikeOwner: true })
    const firefox = persistenceDefines({ browser: "firefox", spikeOwner: true })

    expect(chromium.__SPIKE_OPFS_OWNER__).toBe("true")
    expect(chromium.__SPIKE_OPFS_OWNER_MV2__).toBe("false")
    // MV2 has no offscreen API, so Firefox uses the background-page variant.
    expect(firefox.__SPIKE_OPFS_OWNER__).toBe("false")
    expect(firefox.__SPIKE_OPFS_OWNER_MV2__).toBe("true")
  })

  it("never enables both spike owners at once", () => {
    for (const browser of ["chrome", "firefox"]) {
      for (const spikeOwner of [true, false]) {
        const defines = persistenceDefines({ browser, spikeOwner })
        const enabled = [
          defines.__SPIKE_OPFS_OWNER__,
          defines.__SPIKE_OPFS_OWNER_MV2__
        ].filter((value) => value === "true")

        expect(enabled.length).toBeLessThanOrEqual(1)
      }
    }
  })

  it("resolves the production owner topology from the browser alone", () => {
    expect(
      persistenceDefines({ browser: "firefox", spikeOwner: false })
        .__FIREFOX_BG_OWNER__
    ).toBe("true")
    expect(
      persistenceDefines({ browser: "chrome", spikeOwner: true })
        .__FIREFOX_BG_OWNER__
    ).toBe("false")
  })
})

/*
 * The regression tests for PR #200.
 *
 * The bug was not in either pure function above — both would have been correct
 * whichever variable fed them. It was in the wiring: the spike defines read
 * WXT_BENCHMARK, the variable that also ships persistence-verify.html, so the
 * one build containing that page was the one build where the production owner
 * stood down. Only exercising the real factories against real env vars can
 * catch that, so these do.
 */
describe("env wiring", () => {
  const original = {
    benchmark: process.env.WXT_BENCHMARK,
    spikeOwner: process.env.WXT_SPIKE_OWNER
  }

  const restore = (
    key: "WXT_BENCHMARK" | "WXT_SPIKE_OWNER",
    value?: string
  ) => {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }

  afterEach(() => {
    restore("WXT_BENCHMARK", original.benchmark)
    restore("WXT_SPIKE_OWNER", original.spikeOwner)
  })

  const definesFor = (browser: string): Record<string, string> => {
    const config = vite({ browser } as Parameters<typeof vite>[0]) as {
      define: Record<string, string>
    }
    return config.define
  }

  const strippedFor = (browser: string): string[] => {
    const removed: string[] = []
    const entrypoints = [
      { name: "benchmark" },
      { name: "spike-opfs" },
      { name: "spike-owner" },
      { name: "spike-owner-offscreen" },
      { name: "persistence-verify" },
      { name: "persistence-host" },
      { name: "ingestion-processor" },
      { name: "background" }
    ]
    const before = entrypoints.map((entry) => entry.name)
    stripDevEntrypoints("build", browser, entrypoints)
    const after = new Set(entrypoints.map((entry) => entry.name))
    for (const name of before) if (!after.has(name)) removed.push(name)
    return removed
  }

  it("keeps the production owner live in a benchmark build", () => {
    process.env.WXT_BENCHMARK = "1"
    delete process.env.WXT_SPIKE_OWNER

    for (const browser of ["chrome", "firefox"]) {
      const defines = definesFor(browser)
      expect(defines.__SPIKE_OPFS_OWNER__).toBe("false")
      expect(defines.__SPIKE_OPFS_OWNER_MV2__).toBe("false")
    }
  })

  it("ships persistence-verify in the same build that keeps that owner", () => {
    process.env.WXT_BENCHMARK = "1"
    delete process.env.WXT_SPIKE_OWNER

    // The pairing is the whole point: the verify page and a live production
    // owner have to arrive in one build, or verify:opfs-migration measures an
    // absent owner and reports a null backend marker.
    expect(strippedFor("chrome")).not.toContain("persistence-verify")
    expect(definesFor("chrome").__SPIKE_OPFS_OWNER__).toBe("false")
  })

  it("hands the slot over only when the spike build asks for it", () => {
    process.env.WXT_BENCHMARK = "1"
    process.env.WXT_SPIKE_OWNER = "1"

    expect(definesFor("chrome").__SPIKE_OPFS_OWNER__).toBe("true")
    expect(definesFor("firefox").__SPIKE_OPFS_OWNER_MV2__).toBe("true")
  })

  it("strips every dev page and both spike owners with no env set", () => {
    delete process.env.WXT_BENCHMARK
    delete process.env.WXT_SPIKE_OWNER

    expect(strippedFor("chrome")).toContain("persistence-verify")
    expect(definesFor("chrome").__SPIKE_OPFS_OWNER__).toBe("false")
    expect(definesFor("firefox").__SPIKE_OPFS_OWNER_MV2__).toBe("false")
  })
})

describe("module preloading", () => {
  it("emits no preload hints for either browser", () => {
    // Extension chunks are on local disk, so a preload hint starts nothing
    // early — and Chrome charges for each unused one twice, as "preloaded but
    // not used" and as a cross-world resource mismatch. That was 46 console
    // warnings on one page load, burying the extension's own logs.
    for (const browser of ["chrome", "firefox"]) {
      const config = vite({ browser } as Parameters<typeof vite>[0]) as {
        build?: { modulePreload?: unknown }
      }
      expect(config.build?.modulePreload).toBe(false)
    }
  })
})
