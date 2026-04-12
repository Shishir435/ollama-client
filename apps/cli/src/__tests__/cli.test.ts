import { spawnSync } from "node:child_process"
import { describe, expect, it } from "vitest"

const runCli = (args: string[], env?: Record<string, string>) =>
  spawnSync("pnpm", ["exec", "tsx", "src/index.ts", ...args], {
    cwd: process.cwd(),
    encoding: "utf-8",
    env: {
      ...process.env,
      ...env
    }
  })

describe("olc CLI", () => {
  it("shows help output", () => {
    const result = runCli(["--help"])
    expect(result.status).toBe(0)
    expect(result.stdout).toContain("Commands:")
    expect(result.stdout).toContain("serve")
    expect(result.stdout).toContain("doctor")
  })

  it("runs doctor command", () => {
    const configPath = "/tmp/olc-cli-test-config.json"
    const result = runCli(["doctor"], { OLC_CONFIG_PATH: configPath })
    expect(result.status).toBe(0)
    expect(result.stdout).toContain("Config:")
  })
})
