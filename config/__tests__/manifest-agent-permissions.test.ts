import { describe, expect, it } from "vitest"

import config from "../../wxt.config"

type ManifestFn = (env: {
  browser: string
  command: string
  manifestVersion: number
  mode: string
}) => { permissions?: string[]; optional_permissions?: string[] }

const manifestFor = (browser: string) =>
  (config.manifest as unknown as ManifestFn)({
    browser,
    command: "build",
    manifestVersion: browser === "firefox" ? 2 : 3,
    mode: "production"
  })

describe("Agent perception permission placement", () => {
  it("requires debugger only for Chromium Agent control", () => {
    expect(manifestFor("chrome").permissions).toContain("debugger")
    expect(manifestFor("chrome").optional_permissions).not.toContain("debugger")
    expect(manifestFor("firefox").permissions).not.toContain("debugger")
    expect(manifestFor("firefox").optional_permissions).not.toContain(
      "debugger"
    )
  })

  it("declares webNavigation as optional rather than standing", () => {
    for (const browser of ["chrome", "firefox"]) {
      const manifest = manifestFor(browser)
      expect(manifest.optional_permissions).toContain("webNavigation")
      expect(manifest.permissions).not.toContain("webNavigation")
    }
  })

  it("does not add unrelated powerful permissions", () => {
    const manifest = manifestFor("chrome")
    for (const permission of [
      "cookies",
      "webRequest",
      "nativeMessaging",
      "power"
    ]) {
      expect(manifest.permissions).not.toContain(permission)
      expect(manifest.optional_permissions).not.toContain(permission)
    }
  })
})
