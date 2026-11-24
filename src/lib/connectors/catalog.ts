import type { LocalServerEntry } from "./mcp-config"

/**
 * Popular MCP servers as configuration, not code: each preset only builds the
 * README's own `command`/`args` entry from what the user fills in. Commands
 * follow the servers' official READMEs. All run on the user's machine through
 * a bridge; none needs a cloud account except GitHub, which needs a token.
 */

export type CatalogRuntime = "npx" | "uvx" | "docker"

export interface CatalogParam {
  id: string
  labelKey: string
  placeholder: string
  required: boolean
  /** Secrets go into the user's local bridge file and nowhere else. */
  secret?: boolean
}

export interface CatalogEntry {
  id: string
  /** Product names stay untranslated. */
  name: string
  descriptionKey: string
  runtime: CatalogRuntime
  homepage: string
  params: readonly CatalogParam[]
  build: (values: Record<string, string>) => LocalServerEntry
}

const value = (values: Record<string, string>, id: string): string =>
  values[id]?.trim() ?? ""

export const MCP_CATALOG: readonly CatalogEntry[] = [
  {
    id: "filesystem",
    name: "Filesystem",
    descriptionKey: "settings.connectors.catalog.items.filesystem",
    runtime: "npx",
    homepage:
      "https://github.com/modelcontextprotocol/servers/tree/main/src/filesystem",
    params: [
      {
        id: "path",
        labelKey: "settings.connectors.catalog.params.folder",
        placeholder: "/Users/me/Documents",
        required: true
      }
    ],
    build: (values) => ({
      name: "filesystem",
      command: "npx",
      args: [
        "-y",
        "@modelcontextprotocol/server-filesystem",
        value(values, "path")
      ]
    })
  },
  {
    id: "memory",
    name: "Memory",
    descriptionKey: "settings.connectors.catalog.items.memory",
    runtime: "npx",
    homepage:
      "https://github.com/modelcontextprotocol/servers/tree/main/src/memory",
    params: [],
    build: () => ({
      name: "memory",
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-memory"]
    })
  },
  {
    id: "fetch",
    name: "Fetch",
    descriptionKey: "settings.connectors.catalog.items.fetch",
    runtime: "uvx",
    homepage:
      "https://github.com/modelcontextprotocol/servers/tree/main/src/fetch",
    params: [],
    build: () => ({ name: "fetch", command: "uvx", args: ["mcp-server-fetch"] })
  },
  {
    id: "git",
    name: "Git",
    descriptionKey: "settings.connectors.catalog.items.git",
    runtime: "uvx",
    homepage:
      "https://github.com/modelcontextprotocol/servers/tree/main/src/git",
    params: [
      {
        id: "repository",
        labelKey: "settings.connectors.catalog.params.repository",
        placeholder: "/Users/me/code/project",
        required: true
      }
    ],
    build: (values) => ({
      name: "git",
      command: "uvx",
      args: ["mcp-server-git", "--repository", value(values, "repository")]
    })
  },
  {
    id: "time",
    name: "Time",
    descriptionKey: "settings.connectors.catalog.items.time",
    runtime: "uvx",
    homepage:
      "https://github.com/modelcontextprotocol/servers/tree/main/src/time",
    params: [
      {
        id: "timezone",
        labelKey: "settings.connectors.catalog.params.timezone",
        placeholder: "Europe/London",
        required: false
      }
    ],
    build: (values) => {
      const timezone = value(values, "timezone")
      return {
        name: "time",
        command: "uvx",
        args: [
          "mcp-server-time",
          ...(timezone ? [`--local-timezone=${timezone}`] : [])
        ]
      }
    }
  },
  {
    id: "sequential-thinking",
    name: "Sequential Thinking",
    descriptionKey: "settings.connectors.catalog.items.sequential_thinking",
    runtime: "npx",
    homepage:
      "https://github.com/modelcontextprotocol/servers/tree/main/src/sequentialthinking",
    params: [],
    build: () => ({
      name: "sequential-thinking",
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-sequential-thinking"]
    })
  },
  {
    id: "playwright",
    name: "Playwright",
    descriptionKey: "settings.connectors.catalog.items.playwright",
    runtime: "npx",
    homepage: "https://github.com/microsoft/playwright-mcp",
    params: [],
    build: () => ({
      name: "playwright",
      command: "npx",
      args: ["-y", "@playwright/mcp@latest"]
    })
  },
  {
    id: "github",
    name: "GitHub",
    descriptionKey: "settings.connectors.catalog.items.github",
    runtime: "docker",
    homepage: "https://github.com/github/github-mcp-server",
    params: [
      {
        id: "token",
        labelKey: "settings.connectors.catalog.params.github_token",
        placeholder: "github_pat_…",
        required: true,
        secret: true
      }
    ],
    build: (values) => ({
      name: "github",
      command: "docker",
      args: [
        "run",
        "-i",
        "--rm",
        "-e",
        "GITHUB_PERSONAL_ACCESS_TOKEN",
        "ghcr.io/github/github-mcp-server"
      ],
      env: { GITHUB_PERSONAL_ACCESS_TOKEN: value(values, "token") }
    })
  }
]

export const catalogEntryReady = (
  entry: CatalogEntry,
  values: Record<string, string>
): boolean =>
  entry.params.every((param) => !param.required || value(values, param.id))
