/**
 * Materializes and maintains the OpenCode bridge plugin.
 *
 * Purpose: OpenCode registers plugin tools when a plugin loads, so the set of
 * client tools it can call is whatever the manifest said at load time. This module
 * owns that manifest — writing it, diffing it against the running registration,
 * and reporting when OpenCode has to reload to pick up a change.
 *
 * Note: the plugin is installed outside the OpenCode project directory so the
 * proxy never writes into a user's workspace, and its sources are copied as
 * TypeScript — OpenCode's runtime executes them directly, so nothing compiles them. OpenCode resolves a `file://`
 * plugin's imports from the plugin's own directory, which is why the install step
 * links its plugin runtime next to the copied files. Without that link OpenCode
 * skips the plugin silently, so callers must verify registration.
 */
import fs from "node:fs"
import path from "node:path"
import type { BridgeToolDefinition, OpenAIToolDefinition } from "../../types.js"
import { isRecord } from "../../util.js"

const PLUGIN_FILES = ["bridge.ts", "json-schema.ts", "opencode-plugin.d.ts"]
const MANIFEST_FILENAME = "manifest.json"

/**
 * Reduce an OpenAI `tools` array to the definitions the plugin can register.
 * Entries without a usable function name are dropped rather than guessed at, and
 * the result is name-sorted so a reordered request is not treated as a change.
 */
export const normalizeToolDefinitions = (
  tools: unknown
): BridgeToolDefinition[] => {
  if (!Array.isArray(tools)) return []
  const seen = new Set<string>()
  const definitions: BridgeToolDefinition[] = []

  for (const entry of tools as OpenAIToolDefinition[]) {
    const fn = isRecord(entry) ? entry.function : undefined
    const name =
      isRecord(fn) && typeof fn.name === "string" ? fn.name.trim() : ""
    if (!name || seen.has(name)) continue
    seen.add(name)
    definitions.push({
      name,
      description:
        isRecord(fn) && typeof fn.description === "string"
          ? fn.description
          : "",
      parameters: isRecord(fn) && isRecord(fn.parameters) ? fn.parameters : {}
    })
  }

  return definitions.sort((left, right) => left.name.localeCompare(right.name))
}

/**
 * Registration identity of a manifest. Descriptions and parameter schemas are part
 * of it because the plugin reads them at load time, so a changed schema is as much
 * a reload trigger as a new tool name.
 */
export const manifestSignature = (
  definitions: BridgeToolDefinition[]
): string =>
  JSON.stringify(
    definitions.map((definition) => [
      definition.name,
      definition.description,
      definition.parameters
    ])
  )

export class ToolManifest {
  readonly directory: string
  private readonly endpoint: string
  private readonly token: string
  private readonly log: (message: string) => void
  private definitions: BridgeToolDefinition[] = []
  private signature = manifestSignature([])
  private installed = false

  constructor({
    directory,
    endpoint,
    token,
    log
  }: {
    directory: string
    endpoint: string
    token: string
    log?: (message: string) => void
  }) {
    this.directory = directory
    this.endpoint = endpoint
    this.token = token
    this.log = log ?? (() => {})
  }

  get manifestPath(): string {
    return path.join(this.directory, MANIFEST_FILENAME)
  }

  get pluginEntry(): string {
    return `file://${path.join(this.directory, "bridge.ts")}`
  }

  get names(): string[] {
    return this.definitions.map((definition) => definition.name)
  }

  /**
   * Copy the plugin sources into the generated directory and link the runtime
   * OpenCode resolves plugin imports against. Returns whether the link exists,
   * since a missing one is the difference between a working bridge and a silently
   * ignored plugin.
   */
  install({
    sourceDirectory,
    pluginRuntimeDirectory
  }: {
    sourceDirectory: string
    pluginRuntimeDirectory?: string | null
  }): { linked: boolean } {
    fs.mkdirSync(this.directory, { recursive: true })
    for (const file of PLUGIN_FILES) {
      fs.copyFileSync(
        path.join(sourceDirectory, file),
        path.join(this.directory, file)
      )
    }
    this.installed = true
    this.writeManifest()

    let linked = false
    if (pluginRuntimeDirectory && fs.existsSync(pluginRuntimeDirectory)) {
      const link = path.join(this.directory, "node_modules")
      try {
        fs.rmSync(link, { recursive: true, force: true })
        fs.symlinkSync(pluginRuntimeDirectory, link, "dir")
        linked = true
      } catch (error) {
        this.log(`Failed to link plugin runtime: ${(error as Error).message}`)
      }
    }

    return { linked }
  }

  writeManifest(): void {
    fs.writeFileSync(
      this.manifestPath,
      `${JSON.stringify(
        {
          version: 1,
          endpoint: this.endpoint,
          token: this.token,
          tools: this.definitions
        },
        null,
        2
      )}\n`,
      "utf8"
    )
  }

  /**
   * Record the tools of one request. Returns `changed: true` when OpenCode has to
   * reload before it can call them, which is the caller's cue to dispose the
   * instance.
   */
  sync(tools: unknown): { changed: boolean; names: string[] } {
    const definitions = normalizeToolDefinitions(tools)
    const signature = manifestSignature(definitions)
    if (signature === this.signature) {
      return { changed: false, names: this.names }
    }

    this.definitions = definitions
    this.signature = signature
    if (this.installed) this.writeManifest()
    return { changed: true, names: this.names }
  }

  /** Names the manifest declares that OpenCode does not report as registered. */
  missingRegistrations(registeredIds: unknown): string[] {
    const registered = new Set(
      Array.isArray(registeredIds) ? (registeredIds as string[]) : []
    )
    return this.names.filter((name) => !registered.has(name))
  }
}
