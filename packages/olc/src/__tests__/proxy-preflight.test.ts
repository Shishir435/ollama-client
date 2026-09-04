import { describe, expect, it } from "vitest"
import type { Listener } from "../ollama/process.js"
import {
  assertProxyPortAvailable,
  describePortConflict,
  findFreePort,
  type PreflightDependencies
} from "../proxy-preflight.js"

const listener = (overrides: Partial<Listener> = {}): Listener => ({
  pid: 4242,
  identity: "501 Mon Jan 1 00:00:00 2026 node",
  host: "127.0.0.1",
  executable: "/usr/local/bin/node",
  uid: 501,
  ...overrides
})

const bindError = (code: string): NodeJS.ErrnoException =>
  Object.assign(new Error(`listen ${code}`), { code })

/** No OS inspection, no sockets: policy is tested without touching the machine. */
function deps(overrides: Partial<PreflightDependencies> = {}) {
  return {
    listeners: async () => [listener()],
    probe: async () => ({ backend: "opencode" }),
    bind: async (_host: string, port: number) =>
      port === 8085 ? undefined : bindError("EADDRINUSE"),
    ...overrides
  } satisfies PreflightDependencies
}

const request = { backend: "opencode", host: "127.0.0.1", port: 8084 }

describe("proxy port preflight", () => {
  it("lets a launch through when the requested address actually binds", async () => {
    await expect(
      assertProxyPortAvailable(request, deps({ bind: async () => undefined }))
    ).resolves.toBeUndefined()
  })

  it("reports the occupant and a free port instead of a bind error", async () => {
    await expect(assertProxyPortAvailable(request, deps())).rejects.toThrow(
      "Port 8084 is already in use."
    )
  })

  it("names a same-backend proxy as usable as it is", async () => {
    const message = await describePortConflict(request, deps())
    expect(message).toContain("olc opencode proxy (PID 4242)")
    expect(message).toContain("http://127.0.0.1:8084")
    expect(message).toContain("olc -b opencode --port 8085")
  })

  it("does not offer another backend's proxy as this backend", async () => {
    const message = await describePortConflict(
      request,
      deps({ probe: async () => ({ backend: "codex" }) })
    )
    expect(message).toContain("olc codex proxy (PID 4242), not opencode")
    expect(message).not.toContain("as it is")
  })

  it("never suggests reusing a process that did not answer as a proxy", async () => {
    const message = await describePortConflict(
      request,
      deps({
        probe: async () => undefined,
        listeners: async () => [listener({ executable: "/opt/bin/vite" })]
      })
    )
    expect(message).toContain("held by vite (PID 4242)")
    expect(message).toContain("did not answer as an olc proxy")
    expect(message).not.toContain("http://127.0.0.1:8084")
  })

  it("still reports the conflict when listeners cannot be inspected", async () => {
    const message = await describePortConflict(
      request,
      deps({
        probe: async () => undefined,
        listeners: async () => {
          throw new Error("Cannot inspect the listening process.")
        }
      })
    )
    expect(message).toContain("could not be identified")
    expect(message).toContain("Stop whatever is using it")
    expect(message).toContain("--port 8085")
  })

  it("reports ambiguity rather than picking one of several listeners", async () => {
    const message = await describePortConflict(
      request,
      deps({
        probe: async () => undefined,
        listeners: async () => [listener(), listener({ pid: 4243 })]
      })
    )
    expect(message).toContain("Several processes are listening on it")
    expect(message).not.toContain("PID 4242")
  })

  it("falls back to bare --port when nothing nearby is free", async () => {
    const message = await describePortConflict(
      request,
      deps({ bind: async () => bindError("EADDRINUSE") })
    )
    expect(message).toContain("free port with --port")
    expect(message).not.toContain("--port 8085")
  })

  it("suggests the first port that binds above the requested one", async () => {
    const tried: number[] = []
    const port = await findFreePort(
      "127.0.0.1",
      8084,
      deps({
        bind: async (_host, candidate) => {
          tried.push(candidate)
          return candidate === 8087 ? undefined : bindError("EADDRINUSE")
        }
      })
    )
    expect(port).toBe(8087)
    expect(tried).toEqual([8085, 8086, 8087])
  })
})

describe("bind failures that another port cannot fix", () => {
  it("does not call an unusable address a busy port", async () => {
    await expect(
      assertProxyPortAvailable(
        { ...request, host: "10.1.2.3" },
        deps({ bind: async () => bindError("EADDRNOTAVAIL") })
      )
    ).rejects.toThrow("this machine has no such address")
  })

  it("explains a privileged port rather than suggesting a retry", async () => {
    await expect(
      assertProxyPortAvailable(
        { ...request, port: 80 },
        deps({ bind: async () => bindError("EACCES") })
      )
    ).rejects.toThrow("Ports below 1024 need elevated privileges")
  })

  it("passes an unrecognized bind failure through by code", async () => {
    await expect(
      assertProxyPortAvailable(
        request,
        deps({ bind: async () => bindError("EINVAL") })
      )
    ).rejects.toThrow("Cannot bind 127.0.0.1:8084: EINVAL.")
  })
})

describe("untrusted text from whoever holds the port", () => {
  const ESCAPE = "\u001b"

  it("refuses to print a backend name that is not an identifier", async () => {
    const message = await describePortConflict(
      request,
      deps({
        probe: async () => ({
          backend: `opencode${ESCAPE}]0;pwned${ESCAPE}\u0007`
        })
      })
    )
    expect(message).not.toContain(ESCAPE)
    expect(message).toContain("running some other backend")
  })

  it("strips control characters from a process name", async () => {
    const message = await describePortConflict(
      request,
      deps({
        probe: async () => undefined,
        listeners: async () => [
          listener({ executable: `/bin/ev${ESCAPE}[2Jil\u0000` })
        ]
      })
    )
    expect(message).not.toContain(ESCAPE)
    expect(message).not.toContain("\u0000")
    expect(message).toContain("held by ev[2Jil")
  })

  it("caps a process name a hostile occupant made long", async () => {
    const message = await describePortConflict(
      request,
      deps({
        probe: async () => undefined,
        listeners: async () => [
          listener({ executable: `/bin/${"x".repeat(500)}` })
        ]
      })
    )
    expect(message).toContain("\u2026")
    expect(message.length).toBeLessThan(400)
  })
})

describe.skipIf(process.platform === "win32")("stop guidance", () => {
  it("gives the exact command for the process it identified", async () => {
    expect(await describePortConflict(request, deps())).toContain(
      "kill -TERM 4242"
    )
  })
})
