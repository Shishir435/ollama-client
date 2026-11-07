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

  it("requires webNavigation for Chromium Agent perception only", () => {
    expect(manifestFor("chrome").permissions).toContain("webNavigation")
    expect(manifestFor("chrome").optional_permissions).not.toContain(
      "webNavigation"
    )
    expect(manifestFor("firefox").permissions).not.toContain("webNavigation")
    expect(manifestFor("firefox").optional_permissions).not.toContain(
      "webNavigation"
    )
  })

  /**
   * Arriving in the same release as debugger and webNavigation, so an update
   * from 0.13.x asks once. A required permission cannot be revoked, so it must
   * not also be listed as optional there.
   */
  it("requires tabGroups on Chromium and leaves it optional on Firefox", () => {
    expect(manifestFor("chrome").permissions).toContain("tabGroups")
    expect(manifestFor("chrome").optional_permissions).not.toContain(
      "tabGroups"
    )
    expect(manifestFor("firefox").permissions).not.toContain("tabGroups")
    expect(manifestFor("firefox").optional_permissions).toContain("tabGroups")
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

  /**
   * Firefox has no DNR, so a blocking webRequest listener removes `Origin`
   * from the extension's own provider requests. Chromium uses DNR rules and
   * must not gain either permission.
   */
  it("requires webRequest blocking on Firefox only", () => {
    expect(manifestFor("firefox").permissions).toEqual(
      expect.arrayContaining(["webRequest", "webRequestBlocking"])
    )
    for (const permission of ["webRequest", "webRequestBlocking"]) {
      expect(manifestFor("chrome").permissions).not.toContain(permission)
      expect(manifestFor("chrome").optional_permissions).not.toContain(
        permission
      )
      expect(manifestFor("firefox").optional_permissions).not.toContain(
        permission
      )
    }
  })
})
