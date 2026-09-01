import { describe, expect, it } from "vitest"
import { parseArgs } from "../cli-options.js"
import { resolveOllamaOptions } from "../ollama/config.js"
import { resolveProcessMode } from "../process-mode.js"

describe("process mode", () => {
  it.each([
    "ollama",
    "codex",
    "opencode"
  ])("defaults %s to detached", (BACKEND) => {
    expect(resolveProcessMode({ BACKEND }, {}, {})).toEqual({
      detached: true,
      debug: false
    })
  })
  it("supports explicit switches independently of log verbosity", () => {
    expect(
      resolveProcessMode(parseArgs(["--foreground"]).options, {}, {})
    ).toEqual({ detached: false, debug: false })
    expect(
      resolveProcessMode(parseArgs(["--detached"]).options, {}, {})
    ).toEqual({ detached: true, debug: false })
    expect(resolveProcessMode(parseArgs(["--debug"]).options, {}, {})).toEqual({
      detached: false,
      debug: true
    })
  })
  it("uses debug configuration consistently, including native mode", () => {
    expect(resolveProcessMode({}, { DEBUG: true, DETACHED: true }, {})).toEqual(
      { detached: false, debug: true }
    )
    expect(resolveOllamaOptions({}, {}, { OLC_DEBUG: "1" })).toMatchObject({
      debug: true,
      detached: false
    })
    expect(resolveProcessMode({}, {}, { OLC_DETACHED: "false" }).detached).toBe(
      false
    )
    expect(
      resolveProcessMode({ DETACHED: true }, {}, { OLC_DETACHED: "false" })
        .detached
    ).toBe(true)
  })
  it("rejects contradictory modes instead of relying on flag order", () => {
    expect(() =>
      resolveProcessMode(
        parseArgs(["--foreground", "--detached"]).options,
        {},
        {}
      )
    ).toThrow("not both")
    expect(() =>
      resolveProcessMode(parseArgs(["--detached", "--debug"]).options, {}, {})
    ).toThrow("debug")
    expect(() =>
      resolveProcessMode({ DETACHED: true }, {}, { OLC_DEBUG: "true" })
    ).toThrow("debug")
  })
})
