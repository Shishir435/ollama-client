/** @vitest-environment node */
import { describe, expect, it } from "vitest"
import { catalogEntryReady, MCP_CATALOG } from "../catalog"
import {
  addToBridgePlan,
  buildBridgeConfig,
  parseMcpConfig,
  remoteEntryToDraft
} from "../mcp-config"
import { bridgeNameFor, parseRegistryResponse } from "../registry-search"

describe("parseMcpConfig", () => {
  it("splits a README mcpServers snippet into bridge entries and remote connectors", () => {
    const parsed = parseMcpConfig(
      JSON.stringify({
        mcpServers: {
          filesystem: {
            command: "npx",
            args: ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"],
            env: { DEBUG: "1", IGNORED: 3 }
          },
          notes: {
            url: "https://notes.example/mcp",
            headers: { Authorization: "Bearer abc" }
          },
          legacy: { type: "sse", url: "https://old.example/sse" },
          off: { command: "npx", disabled: true },
          "bad/name": { command: "npx" },
          empty: { args: [] }
        }
      })
    )
    expect(parsed).toEqual({
      local: [
        {
          name: "filesystem",
          command: "npx",
          args: ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"],
          env: { DEBUG: "1" }
        }
      ],
      remote: [
        {
          name: "notes",
          url: "https://notes.example/mcp",
          headers: { Authorization: "Bearer abc" }
        }
      ],
      skipped: [
        { name: "legacy", reason: "sse_only" },
        { name: "off", reason: "disabled" },
        { name: "bad/name", reason: "invalid_name" },
        { name: "empty", reason: "no_command" }
      ]
    })
  })

  it("reads VS Code's nested and top-level server maps, and a bare map", () => {
    const entry = { command: "uvx", args: ["mcp-server-time"] }
    for (const config of [
      { servers: { time: entry } },
      { mcp: { servers: { time: entry } } },
      { time: entry }
    ]) {
      const parsed = parseMcpConfig(JSON.stringify(config))
      expect("error" in parsed ? parsed.error : parsed.local[0]?.name).toBe(
        "time"
      )
    }
  })

  it("reports bad input instead of guessing", () => {
    expect(parseMcpConfig("{nope")).toEqual({ error: "invalid_json" })
    expect(parseMcpConfig("{}")).toEqual({ error: "no_servers" })
    expect(parseMcpConfig('{"theme":"dark"}')).toEqual({ error: "no_servers" })
  })

  it("keeps credentials out of the URL a remote entry is saved under", () => {
    const parsed = parseMcpConfig(
      JSON.stringify({
        mcpServers: { x: { url: "https://user:pw@host.example/mcp" } }
      })
    )
    expect(parsed).toMatchObject({
      remote: [],
      skipped: [{ name: "x", reason: "invalid_url" }]
    })
  })
})

describe("remoteEntryToDraft", () => {
  it("turns an Authorization bearer header into the connector's secret", () => {
    expect(
      remoteEntryToDraft({
        name: "notes",
        url: "https://notes.example/mcp",
        headers: { Authorization: "Bearer abc" }
      })
    ).toEqual({
      draft: {
        type: "mcp-http",
        name: "notes",
        url: "https://notes.example/mcp",
        enabled: true,
        auth: { kind: "bearer" },
        secret: { state: "replaced", value: "abc" }
      }
    })
  })

  it("keeps a single custom header and refuses several", () => {
    expect(
      remoteEntryToDraft({
        name: "a",
        url: "https://a.example/mcp",
        headers: { "X-API-Key": "k" }
      })
    ).toMatchObject({
      draft: { auth: { kind: "header", headerName: "X-API-Key" } }
    })
    expect(
      remoteEntryToDraft({
        name: "a",
        url: "https://a.example/mcp",
        headers: { "X-A": "1", "X-B": "2" }
      })
    ).toEqual({ error: "too_many_headers" })
  })
})

describe("buildBridgeConfig", () => {
  it("writes the README format with the last entry per name winning", () => {
    const text = buildBridgeConfig([
      {
        name: "git",
        command: "uvx",
        args: ["mcp-server-git", "--repository", "/a"]
      },
      {
        name: "git",
        command: "uvx",
        args: ["mcp-server-git", "--repository", "/b"]
      }
    ])
    expect(JSON.parse(text)).toEqual({
      mcpServers: {
        git: { command: "uvx", args: ["mcp-server-git", "--repository", "/b"] }
      }
    })
  })
})

describe("catalog", () => {
  it("builds every preset into a bridge entry once its required fields are filled", () => {
    for (const entry of MCP_CATALOG) {
      const values = Object.fromEntries(
        entry.params.map((param) => [param.id, "x"])
      )
      expect(catalogEntryReady(entry, values)).toBe(true)
      const built = entry.build(values)
      expect(built.name).toMatch(/^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/)
      expect(built.args.every((arg) => arg.length > 0)).toBe(true)
      expect(parseMcpConfig(buildBridgeConfig([built]))).toMatchObject({
        local: [{ name: built.name }]
      })
    }
  })

  it("holds back a preset whose required field is empty", () => {
    const filesystem = MCP_CATALOG.find((entry) => entry.id === "filesystem")
    expect(filesystem && catalogEntryReady(filesystem, { path: "  " })).toBe(
      false
    )
  })
})

describe("registry results", () => {
  const official = (isLatest: boolean, status = "active") => ({
    "io.modelcontextprotocol.registry/official": { isLatest, status }
  })

  it("keeps only the latest active version and maps npm packages to npx", () => {
    const results = parseRegistryResponse({
      servers: [
        {
          server: {
            name: "io.github.example/notes",
            version: "1.0.0",
            packages: [
              { registryType: "npm", identifier: "notes-mcp", version: "1.0.0" }
            ]
          },
          _meta: official(false)
        },
        {
          server: {
            name: "io.github.example/notes",
            description: "Notes",
            version: "1.1.0",
            repository: { url: "https://github.com/example/notes" },
            packages: [
              {
                registryType: "npm",
                identifier: "notes-mcp",
                version: "1.1.0",
                transport: { type: "stdio" },
                runtimeArguments: [{ type: "positional", value: "-y" }],
                packageArguments: [
                  {
                    type: "named",
                    name: "--dir",
                    isRequired: true,
                    valueHint: "path"
                  }
                ],
                environmentVariables: [
                  { name: "NOTES_TOKEN", isRequired: true, isSecret: true }
                ]
              }
            ]
          },
          _meta: official(true)
        },
        {
          server: { name: "io.github.example/gone", packages: [] },
          _meta: official(true, "deleted")
        }
      ]
    })
    expect(results).toHaveLength(1)
    expect(results[0]).toMatchObject({
      name: "io.github.example/notes",
      version: "1.1.0",
      repository: "https://github.com/example/notes",
      install: {
        kind: "local",
        entry: {
          name: "notes",
          command: "npx",
          args: ["-y", "notes-mcp@1.1.0", "--dir", "<path>"],
          env: { NOTES_TOKEN: "<NOTES_TOKEN>" }
        },
        env: [{ name: "NOTES_TOKEN", required: true, secret: true }]
      }
    })
  })

  it("maps pypi to uvx and oci to docker, and uses a streamable-http remote otherwise", () => {
    const [pypi, oci, remote, unsupported] = parseRegistryResponse({
      servers: [
        {
          server: {
            name: "a/py",
            packages: [
              { registryType: "pypi", identifier: "py-mcp", version: "2" }
            ]
          }
        },
        {
          server: {
            name: "a/img",
            packages: [
              {
                registryType: "oci",
                identifier: "ghcr.io/a/img:1",
                environmentVariables: [{ name: "KEY" }]
              }
            ]
          }
        },
        {
          server: {
            name: "a/remote",
            remotes: [
              { type: "sse", url: "https://r.example/sse" },
              { type: "streamable-http", url: "https://r.example/mcp" }
            ]
          }
        },
        {
          server: {
            name: "a/templated",
            remotes: [
              { type: "streamable-http", url: "https://{tenant}.example/mcp" }
            ]
          }
        }
      ]
    })
    expect(pypi.install).toMatchObject({
      kind: "local",
      entry: { command: "uvx", args: ["py-mcp==2"] }
    })
    expect(oci.install).toMatchObject({
      kind: "local",
      entry: {
        command: "docker",
        args: ["run", "-i", "--rm", "-e", "KEY", "ghcr.io/a/img:1"]
      }
    })
    expect(remote.install).toMatchObject({
      kind: "remote",
      entry: { url: "https://r.example/mcp" }
    })
    expect(unsupported.install).toEqual({ kind: "unsupported" })
  })

  it("derives a bridge-safe name from a registry name", () => {
    expect(bridgeNameFor("io.github.someone/My Server!")).toBe("My-Server-")
    expect(bridgeNameFor("///")).toBe("server")
  })
})

describe("addToBridgePlan", () => {
  const tools = (pkg: string) => ({
    name: "tools",
    command: "npx",
    args: ["-y", pkg]
  })

  it("updates a same-named entry in replace mode", () => {
    const first = addToBridgePlan([], tools("a"), "replace")
    const second = addToBridgePlan(first.entries, tools("b"), "replace")
    expect(second.entries).toEqual([tools("b")])
  })

  it("keeps two different servers that share a name in unique mode", () => {
    const first = addToBridgePlan([], tools("owner-a-tools"), "unique")
    const second = addToBridgePlan(
      first.entries,
      tools("owner-b-tools"),
      "unique"
    )
    expect(second.name).toBe("tools-2")
    expect(second.entries.map((entry) => entry.name)).toEqual([
      "tools",
      "tools-2"
    ])
    const again = addToBridgePlan(
      second.entries,
      tools("owner-a-tools"),
      "unique"
    )
    expect(again.entries).toHaveLength(2)
    expect(again.name).toBe("tools")
  })

  it("re-adding a server that lives under a suffixed name is a no-op", () => {
    const first = addToBridgePlan([], tools("a"), "unique")
    const second = addToBridgePlan(first.entries, tools("b"), "unique")
    const again = addToBridgePlan(second.entries, tools("b"), "unique")
    expect(again.name).toBe("tools-2")
    expect(again.entries).toEqual(second.entries)
  })
})
