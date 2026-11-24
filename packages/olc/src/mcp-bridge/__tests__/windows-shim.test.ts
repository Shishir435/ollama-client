import { spawn } from "node:child_process"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { resolveLaunch, spawnEnvironment } from "../launch.js"

/**
 * Runs only on Windows (CI's windows-latest olc job): the escaping is checked
 * by how cmd.exe and a real `.cmd` shim actually parse it, which a test of the
 * generated string elsewhere cannot show.
 */
describe.runIf(process.platform === "win32")("Windows .cmd shim launch", () => {
  let dir = ""

  beforeAll(() => {
    dir = mkdtempSync(path.join(tmpdir(), "olc-shim-"))
    writeFileSync(
      path.join(dir, "echo-args.js"),
      "process.stdout.write(JSON.stringify(process.argv.slice(2)))\n"
    )
    /** The shape npm writes for `npx.cmd` and package bins. */
    writeFileSync(
      path.join(dir, "echo-args.cmd"),
      `@ECHO off\r\n"${process.execPath}" "%~dp0\\echo-args.js" %*\r\n`
    )
  })

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  const run = (args: string[], env: Record<string, string>) =>
    new Promise<string[]>((resolve, reject) => {
      const environment = spawnEnvironment({ env })
      const launch = resolveLaunch("echo-args", args, environment)
      const child = spawn(launch.command, launch.args, {
        env: environment.env,
        shell: false,
        windowsVerbatimArguments: launch.windowsVerbatimArguments,
        stdio: ["ignore", "pipe", "pipe"]
      })
      let out = ""
      let err = ""
      child.stdout.on("data", (chunk) => {
        out += chunk
      })
      child.stderr.on("data", (chunk) => {
        err += chunk
      })
      child.on("error", reject)
      child.on("close", () => {
        try {
          resolve(JSON.parse(out) as string[])
        } catch {
          reject(new Error(`unparseable output: ${out} ${err}`))
        }
      })
    })

  it("finds the shim on the server's own PATH and keeps every argument intact", async () => {
    const args = [
      "plain",
      "with space",
      'quote"inside',
      "100%",
      "%PATH%",
      "a&b",
      "pipe|this",
      "caret^x",
      "(paren)",
      "bang!",
      "<angle>",
      "C:\\Program Files\\dir\\",
      ""
    ]
    const received = await run(args, {
      PATH: `${dir};${process.env.PATH ?? ""}`
    })
    expect(received).toEqual(args)
  })
})
