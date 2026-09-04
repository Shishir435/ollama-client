import { createHash } from "node:crypto"
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync
} from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { parseArgs } from "../cli-options.js"
import {
  type GithubDependencies,
  type GithubResponse,
  normalizeVersion,
  ReleaseLookupError,
  ReleaseNotFoundError,
  resolveRelease
} from "../update/github.js"
import { installRelease, resolveInstallTarget } from "../update/install.js"
import {
  compareVersions,
  runUpdate,
  type UpdateDependencies,
  type UpdateResult
} from "../update/runner.js"

const directories: string[] = []

afterEach(() => {
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true })
})

const release = (
  version: string,
  assets = ["olc.tar.gz", "olc.tar.gz.sha256", "olc.zip", "olc.zip.sha256"]
) => ({
  version,
  prerelease: false,
  assets: assets.map((name) => ({
    name,
    downloadUrl: `https://example.invalid/${version}/${name}`
  }))
})

const answer = (status: number, body?: unknown): GithubResponse => ({
  status,
  rateLimited: false,
  body
})

/** No network and no filesystem: the policy is what is under test. */
function updateDeps(overrides: Partial<UpdateDependencies> = {}) {
  return {
    resolve: async () => release("0.15.0"),
    target: async () => ({ root: "/opt/olc" }),
    install: async () => {},
    entry: () => "/opt/olc/dist/olc.mjs",
    current: () => "0.14.0",
    ...overrides
  } satisfies UpdateDependencies
}

describe("olc update", () => {
  it("installs the latest release when one is newer", async () => {
    const installed: string[] = []
    const result = await runUpdate(
      { requested: "latest", check: false, json: false },
      updateDeps({
        install: async (_target, next) => {
          installed.push(next.version)
        }
      })
    )
    expect(installed).toEqual(["0.15.0"])
    expect(result).toMatchObject({
      status: "updated",
      current: "0.14.0",
      latest: "0.15.0"
    } satisfies Partial<UpdateResult>)
    expect(result.message).toBe("Updated olc 0.14.0 to 0.15.0 in /opt/olc.")
  })

  it("installs a named older release without arguing about it", async () => {
    const result = await runUpdate(
      { requested: "0.13.3", check: false, json: false },
      updateDeps({ resolve: async () => release("0.13.3") })
    )
    expect(result.status).toBe("updated")
    expect(result.latest).toBe("0.13.3")
  })

  it("does nothing when the latest release is already installed", async () => {
    const installed: string[] = []
    const result = await runUpdate(
      { requested: "latest", check: false, json: false },
      updateDeps({
        resolve: async () => release("0.14.0"),
        install: async (_target, next) => {
          installed.push(next.version)
        }
      })
    )
    expect(result.status).toBe("up-to-date")
    expect(result.message).toBe("olc 0.14.0 is the latest release.")
    expect(installed).toEqual([])
  })

  it("does not walk a development build back to the newest release", async () => {
    const installed: string[] = []
    const result = await runUpdate(
      { requested: "latest", check: false, json: false },
      updateDeps({
        resolve: async () => release("0.13.3"),
        install: async (_target, next) => {
          installed.push(next.version)
        }
      })
    )
    expect(installed).toEqual([])
    expect(result.status).toBe("up-to-date")
    expect(result.message).toBe(
      "olc 0.14.0 is newer than the latest release (0.13.3). Install that one with: olc update 0.13.3"
    )
  })

  it("still downgrades to a version the user named", async () => {
    const installed: string[] = []
    await runUpdate(
      { requested: "0.13.3", check: false, json: false },
      updateDeps({
        resolve: async () => release("0.13.3"),
        install: async (_target, next) => {
          installed.push(next.version)
        }
      })
    )
    expect(installed).toEqual(["0.13.3"])
  })

  it("orders releases by their numbers, prereleases first", () => {
    expect(compareVersions("0.14.0", "0.13.3")).toBe(1)
    expect(compareVersions("0.13.3", "0.14.0")).toBe(-1)
    expect(compareVersions("0.14.0", "0.14.0")).toBe(0)
    expect(compareVersions("0.14.0-rc.1", "0.14.0")).toBe(-1)
    expect(compareVersions("1.0.0", "0.99.99")).toBe(1)
  })

  it("never resolves or touches an installation for --check", async () => {
    let resolvedTarget = false
    const result = await runUpdate(
      { requested: "latest", check: true, json: false },
      updateDeps({
        target: async () => {
          resolvedTarget = true
          return { root: "/opt/olc" }
        },
        install: async () => {
          throw new Error("--check must not install")
        }
      })
    )
    expect(resolvedTarget).toBe(false)
    expect(result.status).toBe("available")
    expect(result.message).toContain("0.15.0 is available")
  })
})

describe("resolving a version that was asked for by name", () => {
  const deps = (
    responses: Record<string, GithubResponse>
  ): GithubDependencies => ({
    request: async (route) => responses[route] ?? answer(404)
  })

  it("names the versions that do exist when one does not", async () => {
    const error = await resolveRelease(
      "9.9.9",
      deps({
        "/repos/Shishir435/ollama-client/releases?per_page=20": answer(200, [
          { tag_name: "0.13.3" },
          { tag_name: "0.13.2" }
        ])
      })
    ).catch((thrown: unknown) => thrown)
    expect(error).toBeInstanceOf(ReleaseNotFoundError)
    expect((error as Error).message).toBe(
      "Version 9.9.9 does not exist. Recent releases: 0.13.3, 0.13.2. Full list: https://github.com/Shishir435/ollama-client/releases"
    )
  })

  it("still says a version does not exist when the listing is unavailable", async () => {
    await expect(resolveRelease("9.9.9", deps({}))).rejects.toThrow(
      "Version 9.9.9 does not exist. See https://github.com/Shishir435/ollama-client/releases"
    )
  })

  it("accepts a v-prefixed tag as the version it names", async () => {
    const resolved = await resolveRelease(
      "v0.13.3",
      deps({
        "/repos/Shishir435/ollama-client/releases/tags/0.13.3": answer(200, {
          tag_name: "0.13.3",
          assets: []
        })
      })
    )
    expect(resolved.version).toBe("0.13.3")
  })

  it("refuses a version-shaped argument that is not a version", async () => {
    await expect(resolveRelease("../../etc/passwd", deps({}))).rejects.toThrow(
      ReleaseLookupError
    )
    expect(() => normalizeVersion("latest; rm -rf /")).toThrow(
      "is not a version number"
    )
  })

  it("separates rate limiting from a missing release", async () => {
    await expect(
      resolveRelease("latest", {
        request: async () => ({
          status: 403,
          rateLimited: true,
          body: undefined
        })
      })
    ).rejects.toThrow("rate-limiting")
  })
})

describe("choosing what to replace", () => {
  function install(layout: { packageJson?: boolean; bin?: boolean }) {
    const root = mkdtempSync(path.join(os.tmpdir(), "olc-target-"))
    directories.push(root)
    mkdirSync(path.join(root, "dist"), { recursive: true })
    writeFileSync(path.join(root, "dist", "olc.mjs"), "")
    if (layout.bin !== false) mkdirSync(path.join(root, "bin"))
    if (layout.packageJson) writeFileSync(path.join(root, "package.json"), "{}")
    return root
  }

  it("replaces the directory the running bundle lives in", async () => {
    const root = install({})
    await expect(
      resolveInstallTarget(path.join(root, "dist", "olc.mjs"))
    ).resolves.toEqual({ root })
  })

  it("refuses to overwrite a repository checkout", async () => {
    const root = install({ packageJson: true })
    await expect(
      resolveInstallTarget(path.join(root, "dist", "olc.mjs"))
    ).rejects.toThrow("runs out of the repository")
  })

  it("refuses when olc is running from source", async () => {
    await expect(resolveInstallTarget("/repo/src/cli.ts")).rejects.toThrow(
      "running from source"
    )
    await expect(resolveInstallTarget(undefined)).rejects.toThrow(
      "running from source"
    )
  })

  it("leaves a directory that is not an installation alone", async () => {
    const root = install({ bin: false })
    await expect(
      resolveInstallTarget(path.join(root, "dist", "olc.mjs"))
    ).rejects.toThrow("does not look like an olc installation")
  })
})

describe("installing over a working olc", () => {
  const CONTENT = "new bundle"
  /** The published checksum of CONTENT, so the happy path verifies for real. */
  const DIGEST = createHash("sha256").update(CONTENT).digest("hex")

  function scenario(overrides: { digest?: string } = {}) {
    const parent = mkdtempSync(path.join(os.tmpdir(), "olc-install-"))
    directories.push(parent)
    const root = path.join(parent, "olc")
    mkdirSync(path.join(root, "dist"), { recursive: true })
    mkdirSync(path.join(root, "bin"), { recursive: true })
    writeFileSync(path.join(root, "dist", "olc.mjs"), "old bundle")
    return {
      parent,
      root,
      deps: {
        download: async (_url: string, destination: string) => {
          writeFileSync(destination, CONTENT)
        },
        fetchText: async () => `${overrides.digest ?? DIGEST}  olc.tar.gz\n`,
        extract: async (_archive: string, destination: string) => {
          mkdirSync(path.join(destination, "olc", "dist"), { recursive: true })
          mkdirSync(path.join(destination, "olc", "bin"), { recursive: true })
          writeFileSync(
            path.join(destination, "olc", "dist", "olc.mjs"),
            CONTENT
          )
        }
      }
    }
  }

  it("puts the new release in place and leaves no staging directories", async () => {
    const { parent, root, deps } = scenario()
    await installRelease({ root }, release("0.15.0"), deps)
    expect(readFileSync(path.join(root, "dist", "olc.mjs"), "utf8")).toBe(
      CONTENT
    )
    expect(
      readdirSync(parent).filter((name) => name.startsWith(".olc-"))
    ).toEqual([])
  })

  it("installs nothing when the download does not match its published checksum", async () => {
    const { parent, root, deps } = scenario({ digest: "0".repeat(64) })
    await expect(
      installRelease({ root }, release("0.15.0"), deps)
    ).rejects.toThrow("does not match its published checksum")
    expect(readFileSync(path.join(root, "dist", "olc.mjs"), "utf8")).toBe(
      "old bundle"
    )
    expect(
      readdirSync(parent).filter((name) => name.startsWith(".olc-"))
    ).toEqual([])
  })

  it("refuses a release that has no archive for this platform", async () => {
    const { root, deps } = scenario()
    await expect(
      installRelease({ root }, release("0.15.0", ["notes.txt"]), deps)
    ).rejects.toThrow("has no olc.")
  })
})

describe("update command line", () => {
  it("reads the version as the one positional argument", () => {
    expect(parseArgs(["update", "0.13.3"])).toMatchObject({
      command: "update",
      target: "0.13.3"
    })
    expect(parseArgs(["update"])).toMatchObject({
      command: "update",
      target: undefined
    })
  })

  it("keeps update's own flags", () => {
    const parsed = parseArgs(["update", "--check", "--json"])
    expect(parsed.command).toBe("update")
    expect(parsed.options).toEqual({ CHECK: true, JSON: true })
  })

  it("refuses server options that would say nothing about an update", () => {
    expect(() => parseArgs(["update", "--port", "8084"])).toThrow(
      "PORT configures a server"
    )
    expect(() => parseArgs(["update", "-b", "codex"])).toThrow(
      "BACKEND configures a server"
    )
  })

  it("does not treat a backend argument named update as a command", () => {
    expect(parseArgs(["-b", "opencode"]).command).toBe("serve")
    expect(parseArgs(["--version"])).toMatchObject({
      command: "serve",
      options: { VERSION: true }
    })
  })
})
