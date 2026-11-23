// @vitest-environment node
import http from "node:http"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { afterEach, describe, expect, it } from "vitest"
import { OLC_VERSION } from "../../version.js"
import { createMcpBridge, type McpBridge } from "../bridge.js"
import { StdioChild, taskkillArgs } from "../child.js"
import { formatHttpOrigin, parseMcpConfig } from "../config.js"
import {
  type LaunchEnvironment,
  mergeEnvironment,
  resolveLaunch,
  spawnEnvironment
} from "../launch.js"

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

describe("formatHttpOrigin", () => {
  it.each([
    ["127.0.0.1", "http://127.0.0.1:8086"],
    ["localhost", "http://localhost:8086"],
    ["::1", "http://[::1]:8086"],
    ["[::1]", "http://[::1]:8086"],
    ["fe80::1%en0", "http://[fe80::1%25en0]:8086"],
    ["0.0.0.0", "http://127.0.0.1:8086"],
    ["::", "http://[::1]:8086"],
    ["[::]", "http://[::1]:8086"]
  ])("formats host %j", (host, expected) => {
    expect(formatHttpOrigin(host, 8086)).toBe(expected)
  })
})

describe("resolveLaunch", () => {
  const windows = (files: string[], env: Record<string, string> = {}) =>
    ({
      platform: "win32",
      env: {
        Path: "C:\\bin;C:\\npm",
        PATHEXT: ".COM;.EXE;.BAT;.CMD",
        ComSpec: "C:\\Windows\\System32\\cmd.exe",
        ...env
      },
      isFile: (file: string) =>
        files.some((known) => known.toLowerCase() === file.toLowerCase())
    }) satisfies LaunchEnvironment

  it("resolves against the server's own PATH and PATHEXT, not the bridge's", () => {
    const files = ["D:\\srv\\tool.cmd"]
    const base = windows(files)
    expect(resolveLaunch("tool", [], base).command).toBe("tool")
    const launch = resolveLaunch("tool", [], {
      ...base,
      env: { ...base.env, Path: "D:\\srv" }
    })
    expect(launch.args[3]?.toLowerCase()).toContain("d:\\srv\\tool.cmd")
  })

  it("resolves a relative command against the server's cwd", () => {
    const files = ["D:\\work\\bin\\run.cmd"]
    const base = windows(files)
    expect(resolveLaunch(".\\bin\\run", [], base).command).toBe(".\\bin\\run")
    const launch = resolveLaunch(".\\bin\\run", [], {
      ...base,
      cwd: "D:\\work"
    })
    expect(launch.args[3]?.toLowerCase()).toContain("d:\\work\\bin\\run.cmd")
  })

  it("overlays the server env on the process env for spawn", () => {
    const environment = spawnEnvironment({
      env: { OLC_TEST_ONLY: "1" },
      cwd: "/x"
    })
    expect(environment.env.OLC_TEST_ONLY).toBe("1")
    expect(environment.env.PATH ?? environment.env.Path).toBe(
      process.env.PATH ?? process.env.Path
    )
    expect(environment.cwd).toBe("/x")
  })

  it("passes the command through unchanged off Windows", () => {
    expect(
      resolveLaunch("npx", ["-y", "a b"], {
        platform: "linux",
        env: {},
        isFile: () => false
      })
    ).toEqual({ command: "npx", args: ["-y", "a b"] })
  })

  it("resolves a .cmd shim through PATH and runs it under cmd.exe", () => {
    const launch = resolveLaunch(
      "npx",
      ["-y", "pkg", "a b", 'say "hi"', "x&calc", "%PATH%"],
      windows(["C:\\npm\\npx.CMD"])
    )
    expect(launch.command).toBe("C:\\Windows\\System32\\cmd.exe")
    expect(launch.windowsVerbatimArguments).toBe(true)
    expect(launch.args.slice(0, 3)).toEqual(["/d", "/s", "/c"])
    const line = launch.args[3] as string
    expect(line.startsWith('"') && line.endsWith('"')).toBe(true)
    expect(line).toContain('^"C:\\npm\\npx.CMD^"')
    /** A shim re-parses its arguments, so each metacharacter is escaped twice. */
    expect(line).toContain('^^^"a^^^ b^^^"')
    expect(line).toContain('^^^"x^^^&calc^^^"')
    expect(line).toContain('^^^"^^^%PATH^^^%^^^"')
    expect(line).not.toMatch(/[^^]&calc/)
  })

  it("launches a resolved .exe directly", () => {
    expect(
      resolveLaunch("node", ["a b"], windows(["C:\\bin\\node.EXE"]))
    ).toEqual({ command: "C:\\bin\\node.EXE", args: ["a b"] })
  })

  it("accepts an explicit extension and an explicit path", () => {
    const env = windows(["C:\\tools\\run.bat"])
    expect(resolveLaunch("C:\\tools\\run.bat", [], env).args[3]).toContain(
      "run.bat"
    )
    expect(resolveLaunch("C:\\tools\\run", [], env).command).toBe(
      env.env.ComSpec
    )
  })

  it("falls back to the bare command when nothing resolves", () => {
    expect(resolveLaunch("ghost", ["x"], windows([]))).toEqual({
      command: "ghost",
      args: ["x"]
    })
  })

  it("refuses a newline in a shim argument", () => {
    expect(() =>
      resolveLaunch("npx", ["a\nb"], windows(["C:\\npm\\npx.cmd"]))
    ).toThrow(/newlines/)
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
          stubborn: {
            command: process.execPath,
            args: [fixture],
            env: { FAKE_MODE: "ignore-term" }
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
          { name: "stubborn", path: "/mcp/stubborn" },
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

  describe("process lifecycle", () => {
    const alive = (pid: number) => {
      try {
        process.kill(pid, 0)
        return true
      } catch {
        return false
      }
    }

    it("close() resolves only after a SIGTERM-ignoring child is gone", async () => {
      await start()
      const body = await read(await post(rpc(1, "pid"), {}, "stubborn"))
      const pid = body.result.pid as number
      expect(alive(pid)).toBe(true)
      await bridge?.close()
      bridge = undefined
      expect(alive(pid)).toBe(false)
    }, 15_000)

    it("stops the whole tree with taskkill on win32 and stays bounded", async () => {
      const calls: string[][] = []
      const child = new StdioChild({
        name: "win",
        spec: { command: process.execPath, args: [fixture], env: {} },
        timeoutMs: 5000,
        debug: false,
        log: () => undefined,
        platform: "win32",
        killTree: (pid, force) => {
          calls.push(taskkillArgs(pid, force))
          if (force) process.kill(pid, "SIGKILL")
        }
      })
      child.ensureStarted()
      const body = await child.request(rpc(1, "pid") as never)
      const pid = (body.result as { pid: number }).pid
      await child.stop()
      expect(calls[0]).toEqual(["/pid", String(pid), "/T"])
      expect(calls[1]).toEqual(["/pid", String(pid), "/T", "/F"])
      expect(alive(pid)).toBe(false)
    }, 15_000)

    it("delivers a response written just before the child exits", async () => {
      await start()
      const response = await post(rpc(1, "bye"))
      expect(response.status).toBe(200)
      expect(await read(response)).toMatchObject({
        id: 1,
        result: { bye: true }
      })
    })
  })

  describe("cancellation", () => {
    const cancelled = (requestId: string | number) => ({
      jsonrpc: "2.0",
      method: "notifications/cancelled",
      params: { requestId, reason: "user" }
    })
    const waitForLog = async (needle: string) => {
      for (let i = 0; i < 100; i++) {
        if (logs.some((line) => line.includes(needle))) return
        await new Promise((resolve) => setTimeout(resolve, 20))
      }
    }

    it("rewrites the client's request id to the child's id", async () => {
      await start()
      const pending = post(rpc("client-x", "never")).catch(() => undefined)
      await waitForLog("got never")
      const response = await post(cancelled("client-x"))
      expect(response.status).toBe(202)
      await waitForLog("cancelled")
      const line = logs.find((entry) => entry.startsWith("[fake] cancelled"))
      expect(line).toBe('[fake] cancelled {"requestId":1,"reason":"user"}')
      await bridge?.close()
      bridge = undefined
      await pending
    })

    it("drops a cancellation when two clients have the same id in flight", async () => {
      await start()
      const first = post(rpc(1, "never")).catch(() => undefined)
      const second = post(rpc(1, "never")).catch(() => undefined)
      for (let i = 0; i < 100; i++) {
        if (logs.filter((line) => line.includes("got never")).length >= 2) break
        await new Promise((resolve) => setTimeout(resolve, 20))
      }
      expect((await post(cancelled(1))).status).toBe(202)
      await new Promise((resolve) => setTimeout(resolve, 200))
      expect(logs.some((line) => line.includes("cancelled"))).toBe(false)
      await bridge?.close()
      bridge = undefined
      await Promise.all([first, second])
    })

    it("drops a cancellation for a request that is not in flight", async () => {
      await start()
      await post(rpc(1, "ping"))
      const response = await post(cancelled(1))
      expect(response.status).toBe(202)
      expect((await post(cancelled("nope"))).status).toBe(202)
      await post(rpc(2, "ping"))
      expect(logs.some((line) => line.includes("cancelled"))).toBe(false)
    })
  })
})

describe("mergeEnvironment", () => {
  it("lets a server's PATH replace the parent's Path on Windows", () => {
    const merged = mergeEnvironment(
      { Path: "C:\\parent", PATHEXT: ".EXE;.CMD", Other: "x" },
      { PATH: "C:\\server", pathext: ".CMD" },
      "win32"
    )
    expect(merged).toEqual({ PATH: "C:\\server", pathext: ".CMD", Other: "x" })
  })

  it("resolves a shim found only on the server's own PATH", () => {
    const environment: LaunchEnvironment = {
      platform: "win32",
      env: mergeEnvironment(
        { Path: "C:\\parent", PATHEXT: ".EXE;.CMD", ComSpec: "cmd.exe" },
        { PATH: "C:\\server" },
        "win32"
      ),
      isFile: (file) => file.toLowerCase() === "c:\\server\\tool.cmd"
    }
    const launch = resolveLaunch("tool", ["--flag"], environment)
    expect(launch.command).toBe("cmd.exe")
    expect(launch.args.join(" ").toLowerCase()).toContain(
      "c:\\server\\tool.cmd"
    )
  })

  it("keeps distinct casings elsewhere, where names are case-sensitive", () => {
    expect(
      mergeEnvironment({ Path: "/parent" }, { PATH: "/server" }, "linux")
    ).toEqual({ Path: "/parent", PATH: "/server" })
  })
})
