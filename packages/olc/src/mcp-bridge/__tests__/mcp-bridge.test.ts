// @vitest-environment node
import http from "node:http"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { afterEach, describe, expect, it } from "vitest"
import { OLC_VERSION } from "../../version.js"
import { createMcpBridge, type McpBridge } from "../bridge.js"
import { parseMcpConfig } from "../config.js"

const fixture = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "fixtures",
  "fake-mcp-server.mjs"
)
const TOKEN = "test-token"

describe("parseMcpConfig", () => {
  const server = { command: "node" }

  it("applies defaults and normalises servers", () => {
    const config = parseMcpConfig({ servers: { fs: server } }, "/base")
    expect(config).toEqual({
      port: 8086,
      host: "127.0.0.1",
      servers: { fs: { command: "node", args: [], env: {} } }
    })
  })

  it("resolves a relative cwd against the config directory", () => {
    const config = parseMcpConfig(
      { servers: { fs: { command: "node", cwd: "work" } } },
      "/base"
    )
    expect(config.servers.fs?.cwd).toBe(path.resolve("/base", "work"))
  })

  it.each(["Playwright", "sequential-thinking", "a.b_c", "a".repeat(64)])(
    "accepts server name %j",
    (name) => {
      const config = parseMcpConfig({ servers: { [name]: server } })
      expect(Object.keys(config.servers)).toEqual([name])
    }
  )

  it.each(["-x", "x/y", "", "a".repeat(65), "a b", "_x"])(
    "rejects server name %j",
    (name) => {
      expect(() => parseMcpConfig({ servers: { [name]: server } })).toThrow(
        /Invalid MCP server name/
      )
    }
  )

  it("accepts the mcpServers format", () => {
    const config = parseMcpConfig(
      { mcpServers: { memory: { command: "npx", args: ["-y", "x"] } } },
      "/base"
    )
    expect(config.servers).toEqual({
      memory: { command: "npx", args: ["-y", "x"], env: {} }
    })
  })

  it("rejects a config with both server maps", () => {
    expect(() =>
      parseMcpConfig({ mcpServers: { a: server }, servers: { b: server } })
    ).toThrow(/not both/)
  })

  it("skips disabled entries and keeps config order", () => {
    const config = parseMcpConfig({
      mcpServers: {
        b: server,
        off: { command: "node", disabled: true },
        a: server
      }
    })
    expect(Object.keys(config.servers)).toEqual(["b", "a"])
  })

  it("skips remote entries with a notice on stderr", () => {
    const lines: string[] = []
    const config = parseMcpConfig(
      {
        mcpServers: {
          local: server,
          byUrl: { url: "https://example.com/mcp" },
          bySse: { type: "sse", command: "node" },
          byHttp: { type: "streamable-http" },
          plainHttp: { type: "http", url: "http://x" }
        }
      },
      "/base",
      (line) => lines.push(line)
    )
    expect(Object.keys(config.servers)).toEqual(["local"])
    expect(lines).toEqual([
      "skipped byUrl: remote server — add its URL in the extension directly",
      "skipped bySse: remote server — add its URL in the extension directly",
      "skipped byHttp: remote server — add its URL in the extension directly",
      "skipped plainHttp: remote server — add its URL in the extension directly"
    ])
  })

  it("requires at least one stdio server after skipping", () => {
    expect(() =>
      parseMcpConfig({ mcpServers: { a: { url: "http://x" } } }, "/", () => {})
    ).toThrow(/at least one stdio server/)
    expect(() =>
      parseMcpConfig({ servers: { a: { command: "x", disabled: true } } })
    ).toThrow(/at least one stdio server/)
  })

  it("accepts a stdio type and ignores unknown keys", () => {
    const config = parseMcpConfig({
      mcpServers: { a: { type: "stdio", command: "x", extra: 1 } }
    })
    expect(config.servers.a?.command).toBe("x")
  })

  it.each([
    [{ servers: {} }, /at least one stdio server/],
    [{ servers: { a: {} } }, /"command"/],
    [{ servers: { a: { command: "x", args: [1] } } }, /"args"/],
    [{ servers: { a: { command: "x", env: { K: 1 } } } }, /"env"/],
    [{ port: 70000, servers: { a: server } }, /"port"/],
    [{ port: "80", servers: { a: server } }, /"port"/],
    [{ token: "", servers: { a: server } }, /"token"/],
    [[], /JSON object/]
  ])("rejects %j", (raw, message) => {
    expect(() => parseMcpConfig(raw)).toThrow(message)
  })
})

describe("mcp bridge", () => {
  let bridge: McpBridge | undefined
  let base = ""
  const logs: string[] = []

  const start = async (requestTimeoutMs?: number, debug = false) => {
    logs.length = 0
    bridge = createMcpBridge(
      {
        port: 0,
        host: "127.0.0.1",
        servers: {
          fake: { command: process.execPath, args: [fixture], env: {} },
          broken: {
            command: "olc-definitely-not-a-command",
            args: [],
            env: {}
          },
          "my_server.v2": {
            command: process.execPath,
            args: [fixture],
            env: {}
          }
        }
      },
      { token: TOKEN, debug, log: (line) => logs.push(line), requestTimeoutMs }
    )
    const { port } = await bridge.listen()
    base = `http://127.0.0.1:${port}`
  }

  afterEach(async () => {
    await bridge?.close()
    bridge = undefined
  })

  const post = (
    body: unknown,
    headers: Record<string, string> = {},
    name = "fake"
  ) =>
    fetch(`${base}/mcp/${name}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        "Content-Type": "application/json",
        ...headers
      },
      body: typeof body === "string" ? body : JSON.stringify(body)
    })

  /** Typed loosely on purpose: tests assert on the shape they expect. */
  const read = async (response: Response): Promise<any> => response.json()

  const rpc = (id: string | number, method: string, params?: unknown) => ({
    jsonrpc: "2.0",
    id,
    method,
    params
  })

  describe("auth", () => {
    it("rejects a missing or wrong token with 401", async () => {
      await start()
      const none = await fetch(`${base}/mcp/fake`, {
        method: "POST",
        body: "{}"
      })
      expect(none.status).toBe(401)
      expect(await none.json()).toMatchObject({ error: { code: -32000 } })
      const wrong = await post(rpc(1, "ping"), { Authorization: "Bearer nope" })
      expect(wrong.status).toBe(401)
      const scheme = await post(rpc(1, "ping"), { Authorization: TOKEN })
      expect(scheme.status).toBe(401)
    })

    it("rejects a web page origin even with the token", async () => {
      await start()
      const response = await post(rpc(1, "ping"), {
        Origin: "https://evil.example"
      })
      expect(response.status).toBe(403)
    })

    it("allows chrome and firefox extension origins", async () => {
      await start()
      for (const origin of ["chrome-extension://abc", "moz-extension://abc"]) {
        const response = await post(rpc(1, "ping"), { Origin: origin })
        expect(response.status).toBe(200)
      }
    })

    it("serves /health without auth and 404s unknown servers", async () => {
      await start()
      const health = await fetch(`${base}/health`)
      expect(health.status).toBe(200)
      expect(await health.json()).toEqual({ ok: true })
      expect((await post(rpc(1, "ping"), {}, "missing")).status).toBe(404)
    })

    it("answers GET with 405 and DELETE with 200", async () => {
      await start()
      const headers = { Authorization: `Bearer ${TOKEN}` }
      expect((await fetch(`${base}/mcp/fake`, { headers })).status).toBe(405)
      const del = await fetch(`${base}/mcp/fake`, { method: "DELETE", headers })
      expect(del.status).toBe(200)
    })
  })

  describe("GET /servers", () => {
    const get = (headers: Record<string, string> = {}) =>
      fetch(`${base}/servers`, { headers })
    const auth = { Authorization: `Bearer ${TOKEN}` }

    it("requires the token and an extension origin", async () => {
      await start()
      expect((await get()).status).toBe(401)
      expect((await get({ Authorization: "Bearer nope" })).status).toBe(401)
      expect(
        (await get({ ...auth, Origin: "https://evil.example" })).status
      ).toBe(403)
      expect(
        (await get({ ...auth, Origin: "moz-extension://abc" })).status
      ).toBe(200)
    })

    it("lists stdio servers in config order without spawning children", async () => {
      await start()
      const response = await get(auth)
      expect(response.status).toBe(200)
      expect(await response.json()).toEqual({
        bridge: "olc-mcp",
        version: OLC_VERSION,
        servers: [
          { name: "fake", path: "/mcp/fake" },
          { name: "broken", path: "/mcp/broken" },
          { name: "my_server.v2", path: "/mcp/my_server.v2" }
        ]
      })
      expect(logs).toEqual([])
    })

    it("answers other methods with 405", async () => {
      await start()
      const response = await fetch(`${base}/servers`, {
        method: "POST",
        headers: auth,
        body: "{}"
      })
      expect(response.status).toBe(405)
    })

    it("routes a name with a dot and underscore", async () => {
      await start()
      const response = await post(rpc(1, "ping"), {}, "my_server.v2")
      expect(response.status).toBe(200)
      expect((await read(response)).id).toBe(1)
    })
  })

  describe("request validation", () => {
    it("answers malformed JSON, batches and non-messages with 400", async () => {
      await start()
      expect((await post("{not json")).status).toBe(400)
      expect((await post([rpc(1, "ping")])).status).toBe(400)
      expect((await post("7")).status).toBe(400)
      expect((await post({ id: 1, method: "ping" })).status).toBe(400)
      expect((await post(rpc(1, "ping"))).status).toBe(200)
    })

    /**
     * The bridge answers 413 from the declared length, before reading the
     * body. Streaming a real 4 MB upload raced that early reply: the client
     * could still be writing when the socket closed, and fetch reported
     * ECONNRESET instead of the status under load.
     */
    it("refuses a body declared over 4 MB with 413 without reading it", async () => {
      await start()
      const status = await new Promise<number | undefined>(
        (resolve, reject) => {
          const request = http.request(`${base}/mcp/fake`, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${TOKEN}`,
              "Content-Type": "application/json",
              "Content-Length": String(4 * 1024 * 1024 + 1)
            }
          })
          request.on("response", (response) => {
            response.resume()
            resolve(response.statusCode)
          })
          request.on("error", reject)
          request.write("{")
        }
      )
      expect(status).toBe(413)
    })
  })

  describe("forwarding", () => {
    it("restores client ids when replies arrive out of order", async () => {
      await start()
      const [a, b] = await Promise.all([
        post(rpc("client-a", "hold")),
        post(rpc(7, "hold"))
      ])
      const first = await read(a)
      const second = await read(b)
      expect(first.id).toBe("client-a")
      expect(second.id).toBe(7)
      expect(first.result.echoed).not.toBe(second.result.echoed)
      expect(typeof first.result.echoed).toBe("number")
    })

    it("accepts notifications with 202 and an empty body", async () => {
      await start()
      const response = await post({
        jsonrpc: "2.0",
        method: "notifications/progress"
      })
      expect(response.status).toBe(202)
      expect(await response.text()).toBe("")
    })

    it("ignores non-JSON stdout and refuses server-initiated requests", async () => {
      await start(undefined, true)
      const response = await post(rpc(1, "noise"))
      expect(await response.json()).toMatchObject({
        id: 1,
        result: { ok: true }
      })
      expect(logs.some((line) => line.includes("non-JSON stdout"))).toBe(true)
    })

    it("prefixes child stderr with the server name", async () => {
      await start()
      await post(rpc(1, "ping"))
      expect(logs).toContain("[fake] got ping")
    })

    it("answers 504 when the child never replies", async () => {
      await start(100)
      const response = await post(rpc(1, "never"))
      expect(response.status).toBe(504)
      expect(await response.json()).toMatchObject({
        id: 1,
        error: { code: -32000 }
      })
    })
  })

  describe("initialize and sessions", () => {
    it("forwards the first initialize and serves later ones from cache", async () => {
      await start()
      const first = await post(rpc(1, "initialize"))
      const session = first.headers.get("mcp-session-id")
      expect(session).toMatch(/^[0-9a-f-]{36}$/)
      const firstBody = await read(first)
      expect(firstBody.result.serverInfo.n).toBe(1)

      const second = await post(rpc("again", "initialize"))
      const secondBody = await read(second)
      expect(secondBody.id).toBe("again")
      expect(secondBody.result).toEqual(firstBody.result)
      expect(second.headers.get("mcp-session-id")).toBe(session)

      const initialized = {
        jsonrpc: "2.0",
        method: "notifications/initialized"
      }
      expect((await post(initialized)).status).toBe(202)
      expect((await post(initialized)).status).toBe(202)
      await post(rpc(2, "ping"))
      const forwarded = logs.filter((line) => line === "[fake] got initialize")
      expect(forwarded).toHaveLength(1)
      expect(
        logs.filter((line) => line === "[fake] got notifications/initialized")
      ).toHaveLength(1)
    })

    it("answers 404 for a session id that is not current", async () => {
      await start()
      const first = await post(rpc(1, "initialize"))
      const session = first.headers.get("mcp-session-id") as string
      expect(
        (await post(rpc(2, "ping"), { "Mcp-Session-Id": session })).status
      ).toBe(200)
      const stale = await post(rpc(3, "ping"), { "Mcp-Session-Id": "stale" })
      expect(stale.status).toBe(404)
    })

    it("reports 502 on a crash, then restarts with a new session", async () => {
      await start()
      const first = await post(rpc(1, "initialize"))
      const oldSession = first.headers.get("mcp-session-id") as string
      const crashed = await post(rpc(2, "crash"), {
        "Mcp-Session-Id": oldSession
      })
      expect(crashed.status).toBe(502)
      expect(await crashed.json()).toMatchObject({ id: 2, error: {} })

      const stale = await post(rpc(3, "ping"), { "Mcp-Session-Id": oldSession })
      expect(stale.status).toBe(404)

      const fresh = await post(rpc(4, "initialize"))
      expect(fresh.status).toBe(200)
      expect(fresh.headers.get("mcp-session-id")).not.toBe(oldSession)
      expect((await read(fresh)).result.serverInfo.n).toBe(1)
    })

    it("answers 502 instead of crashing when the command cannot start", async () => {
      await start()
      const response = await post(rpc(1, "initialize"), {}, "broken")
      expect(response.status).toBe(502)
      expect((await fetch(`${base}/health`)).status).toBe(200)
    })
  })
})
