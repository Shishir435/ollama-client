/**
 * OpenCode plugin that exposes the calling client's tools to OpenCode's agent.
 *
 * Lifecycle: the proxy writes `manifest.json` beside this file — the tool definitions
 * taken verbatim from the OpenAI `tools` array of a chat request — and asks OpenCode
 * to dispose its instance whenever the manifest changes, which re-runs this plugin.
 * Each registered tool forwards its arguments to the proxy and awaits the result, so
 * the tool itself executes wherever the client lives; OpenCode only sees a normal
 * tool it can call.
 *
 * Note: this file is copied into a generated plugin directory and executed by
 * OpenCode's own runtime, which runs TypeScript directly. It may therefore only
 * import from OpenCode's plugin package and its own siblings, and it is copied rather
 * than compiled by this package's build.
 */

import fs from "node:fs"
import path from "node:path"
import { tool } from "@opencode-ai/plugin"
import { jsonSchemaToZodShape } from "./json-schema.js"

const MANIFEST_FILENAME = "manifest.json"

interface BridgeManifest {
  endpoint: string
  token: string
  tools: {
    name?: unknown
    description?: unknown
    parameters?: unknown
  }[]
}

const readManifest = (directory: string): BridgeManifest => {
  try {
    const raw = fs.readFileSync(path.join(directory, MANIFEST_FILENAME), "utf8")
    const parsed = JSON.parse(raw)
    return {
      endpoint: typeof parsed?.endpoint === "string" ? parsed.endpoint : "",
      token: typeof parsed?.token === "string" ? parsed.token : "",
      tools: Array.isArray(parsed?.tools) ? parsed.tools : []
    }
  } catch {
    return { endpoint: "", token: "", tools: [] }
  }
}

const callBridge = async (
  manifest: BridgeManifest,
  payload: Record<string, unknown>,
  signal: AbortSignal
): Promise<string> => {
  const response = await fetch(manifest.endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-OLC-Token": manifest.token
    },
    body: JSON.stringify(payload),
    signal
  })

  const body = await response.text()
  let parsed: { output?: unknown; error?: unknown } | null = null
  try {
    parsed = body ? JSON.parse(body) : null
  } catch {
    parsed = null
  }

  if (!response.ok) {
    const message =
      parsed && typeof parsed.error === "string" && parsed.error
        ? parsed.error
        : `bridge returned HTTP ${response.status}`
    throw new Error(message)
  }
  if (parsed && typeof parsed.error === "string" && parsed.error) {
    throw new Error(parsed.error)
  }
  if (parsed && typeof parsed.output === "string") return parsed.output
  return parsed ? JSON.stringify(parsed.output ?? null) : ""
}

const createBridge = async () => {
  const directory = import.meta.dirname
  const manifest = readManifest(directory)
  const tools: Record<string, unknown> = {}

  for (const definition of manifest.tools) {
    const name = typeof definition?.name === "string" ? definition.name : ""
    if (!name) continue

    tools[name] = tool({
      description:
        typeof definition.description === "string" && definition.description
          ? definition.description
          : `Client tool ${name}`,
      args: jsonSchemaToZodShape(definition.parameters, tool.schema),
      async execute(args, context) {
        return await callBridge(
          manifest,
          {
            tool: name,
            arguments: args ?? {},
            sessionID: context.sessionID,
            messageID: context.messageID
          },
          context.abort
        )
      }
    })
  }

  const names = Object.keys(tools)
  console.log(
    `[olc][plugin] registered ${names.length} client tool(s)${names.length > 0 ? `: ${names.join(", ")}` : ""}`
  )

  return { tool: tools }
}

export default { id: "olc-bridge", server: createBridge }
export const olcBridge = createBridge
