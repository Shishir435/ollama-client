import { describe, expect, it } from "vitest"
import {
  checkCodexVersion,
  codexVersionWarning,
  parseCodexVersion
} from "../version-check.js"

describe("parseCodexVersion", () => {
  it("reads the CLI's own output and ignores a pre-release tag", () => {
    expect(parseCodexVersion("codex-cli 0.144.4\n")).toEqual([0, 144, 4])
    expect(parseCodexVersion("codex-cli 0.155.0-alpha.16.4")).toEqual([
      0, 155, 0
    ])
    expect(parseCodexVersion("unknown")).toBeUndefined()
  })
})

describe("codexVersionWarning", () => {
  const cache = (version?: string) => ({
    version,
    source: "that last refreshed /home/u/.codex/models_cache.json"
  })

  it("warns when the running CLI is older than the cache's writer", () => {
    const warning = codexVersionWarning({
      running: "codex-cli 0.144.4",
      references: [cache("0.155.0")]
    })
    expect(warning).toContain("codex 0.144.4 is older than the 0.155.0")
    expect(warning).toContain("olc does not update Codex")
  })

  it("stays quiet for the same or a newer CLI, or an unknown version", () => {
    expect(
      codexVersionWarning({
        running: "codex-cli 0.155.0-alpha.16.4",
        references: [cache("0.155.0")]
      })
    ).toBeUndefined()
    expect(
      codexVersionWarning({
        running: "0.160.1",
        references: [cache("0.155.0")]
      })
    ).toBeUndefined()
    expect(
      codexVersionWarning({
        running: undefined,
        references: [cache("0.155.0")]
      })
    ).toBeUndefined()
  })
})

describe("checkCodexVersion", () => {
  /**
   * An old CLI that refreshed the cache itself leaves the cache agreeing
   * with it; the app's bundled Codex still shows it is behind.
   */
  it("compares against the app's bundled Codex when the cache agrees", async () => {
    const versions: Record<string, string> = {
      codex: "codex-cli 0.144.4",
      "/Apps/ChatGPT/codex": "codex-cli 0.157.0"
    }
    const warning = await checkCodexVersion({
      executable: "codex",
      codexHome: "/home/u/.codex",
      bundled: ["/Apps/ChatGPT/codex"],
      version: async (file) => versions[file],
      read: async () => JSON.stringify({ client_version: "0.144.4" })
    })
    expect(warning).toContain("older than the 0.157.0 the ChatGPT app ships")
  })

  it("never runs anything but --version, and never throws", async () => {
    const calls: string[] = []
    const warning = await checkCodexVersion({
      executable: "codex",
      codexHome: "/home/u/.codex",
      bundled: [],
      version: async (executable) => {
        calls.push(executable)
        return "codex-cli 0.144.4"
      },
      read: async () => JSON.stringify({ client_version: "0.155.0" })
    })
    expect(calls).toEqual(["codex"])
    expect(warning).toContain("0.144.4")

    await expect(
      checkCodexVersion({
        executable: "missing",
        codexHome: "/nowhere",
        bundled: ["/nowhere/codex"],
        version: async () => undefined,
        read: async () => {
          throw new Error("ENOENT")
        }
      })
    ).resolves.toBeUndefined()
  })
})
