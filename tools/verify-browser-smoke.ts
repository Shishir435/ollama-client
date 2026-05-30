#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs"
import { resolve } from "node:path"
import { execSync } from "node:child_process"

interface ExtensionManifest {
  manifest_version?: number
  permissions?: string[]
  host_permissions?: string[]
  action?: { default_popup?: string }
  options_ui?: { page?: string }
  options_page?: string
  side_panel?: { default_path?: string }
  background?: {
    service_worker?: string
    scripts?: string[]
  }
  content_scripts?: Array<{ js?: string[] }>
  content_security_policy?:
    | string
    | {
        extension_pages?: string
      }
}

const rootDir = process.cwd()

const run = (command: string): void => {
  console.log(`\n▶ ${command}`)
  execSync(command, {
    cwd: rootDir,
    stdio: "inherit"
  })
}

const readManifest = (relativePath: string): ExtensionManifest => {
  const absolutePath = resolve(rootDir, relativePath)
  return JSON.parse(readFileSync(absolutePath, "utf8")) as ExtensionManifest
}

const assert = (condition: boolean, message: string): void => {
  if (!condition) {
    throw new Error(message)
  }
}

const expectPermission = (
  manifest: ExtensionManifest,
  permission: string,
  browserName: string
): void => {
  const permissions = manifest.permissions || []
  assert(
    permissions.includes(permission),
    `${browserName} manifest missing permission: ${permission}`
  )
}

const expectNoPermission = (
  manifest: ExtensionManifest,
  permission: string,
  browserName: string
): void => {
  const permissions = manifest.permissions || []
  assert(
    !permissions.includes(permission),
    `${browserName} manifest should not include permission: ${permission}`
  )
}

const expectHostPermission = (
  manifest: ExtensionManifest,
  hostPermission: string,
  browserName: string
): void => {
  const hostPermissions =
    manifest.manifest_version === 2
      ? manifest.permissions || []
      : manifest.host_permissions || []
  assert(
    hostPermissions.includes(hostPermission),
    `${browserName} manifest missing host permission: ${hostPermission}`
  )
}

const expectExtensionPage = (
  manifest: ExtensionManifest,
  matcher: RegExp,
  label: string,
  browserName: string
): void => {
  const pages = [
    manifest.action?.default_popup,
    manifest.options_ui?.page,
    manifest.options_page,
    manifest.side_panel?.default_path
  ].filter(Boolean)

  assert(
    pages.some((page) => matcher.test(page)),
    `${browserName} manifest missing extension page: ${label}`
  )
}

const expectBuiltFile = (
  relativePath: string,
  label: string,
  browserName: string
): void => {
  assert(
    existsSync(resolve(rootDir, relativePath)),
    `${browserName} build missing file: ${label}`
  )
}

const expectBackgroundScript = (
  manifest: ExtensionManifest,
  matcher: RegExp,
  label: string,
  browserName: string
): void => {
  const serviceWorker = manifest.background?.service_worker
  const scripts = manifest.background?.scripts || []
  const backgroundEntries = [serviceWorker, ...scripts].filter(Boolean)

  assert(
    backgroundEntries.some((entry) => matcher.test(entry)),
    `${browserName} manifest missing background entry: ${label}`
  )
}

const expectContentScript = (
  manifest: ExtensionManifest,
  matcher: RegExp,
  label: string,
  browserName: string
): void => {
  const scripts = (manifest.content_scripts || []).flatMap(
    (contentScript) => contentScript.js || []
  )

  assert(
    scripts.some((script) => matcher.test(script)),
    `${browserName} manifest missing content script: ${label}`
  )
}

const expectCspToken = (
  manifest: ExtensionManifest,
  token: string,
  browserName: string
): void => {
  const extensionPages =
    typeof manifest.content_security_policy === "string"
      ? manifest.content_security_policy
      : manifest.content_security_policy?.extension_pages || ""
  assert(
    extensionPages.includes(token),
    `${browserName} CSP extension_pages missing token: ${token}`
  )
}

const main = (): void => {
  run("pnpm build")
  run("pnpm build:firefox")
  run("bash tools/post-firefox-manifest.sh")

  const chromeManifest = readManifest("build/chrome-mv3-prod/manifest.json")
  const firefoxManifest = readManifest("build/firefox-mv2-prod/manifest.json")

  expectHostPermission(chromeManifest, "<all_urls>", "Chrome")
  expectHostPermission(firefoxManifest, "<all_urls>", "Firefox")

  expectExtensionPage(chromeManifest, /sidepanel\.html$/, "side panel", "Chrome")
  expectBuiltFile(
    "build/firefox-mv2-prod/sidepanel.html",
    "side panel shell",
    "Firefox"
  )
  expectExtensionPage(chromeManifest, /options\.html$/, "options page", "Chrome")
  expectExtensionPage(firefoxManifest, /options\.html$/, "options page", "Firefox")
  expectBackgroundScript(chromeManifest, /background\.js$/, "message router", "Chrome")
  expectBackgroundScript(firefoxManifest, /background\.js$/, "message router", "Firefox")
  expectContentScript(chromeManifest, /content-scripts\/content\.js$/, "page extraction", "Chrome")
  expectContentScript(firefoxManifest, /content-scripts\/content\.js$/, "page extraction", "Firefox")
  expectContentScript(
    chromeManifest,
    /content-scripts\/selection-button\.js$/,
    "selection overlay",
    "Chrome"
  )
  expectContentScript(
    firefoxManifest,
    /content-scripts\/selection-button\.js$/,
    "selection overlay",
    "Firefox"
  )

  expectPermission(chromeManifest, "storage", "Chrome")
  expectPermission(chromeManifest, "tabs", "Chrome")
  expectPermission(chromeManifest, "contextMenus", "Chrome")
  expectPermission(chromeManifest, "sidePanel", "Chrome")
  expectPermission(chromeManifest, "declarativeNetRequest", "Chrome")

  expectPermission(firefoxManifest, "storage", "Firefox")
  expectPermission(firefoxManifest, "tabs", "Firefox")
  expectPermission(firefoxManifest, "contextMenus", "Firefox")
  expectNoPermission(firefoxManifest, "sidePanel", "Firefox")
  expectNoPermission(firefoxManifest, "declarativeNetRequest", "Firefox")

  expectCspToken(chromeManifest, "connect-src 'self'", "Chrome")
  expectCspToken(chromeManifest, "http://*:*", "Chrome")
  expectCspToken(chromeManifest, "https://*:*", "Chrome")
  expectCspToken(chromeManifest, "ws://*:*", "Chrome")
  expectCspToken(chromeManifest, "wss://*:*", "Chrome")

  expectCspToken(firefoxManifest, "connect-src 'self'", "Firefox")
  expectCspToken(firefoxManifest, "http://*:*", "Firefox")
  expectCspToken(firefoxManifest, "https://*:*", "Firefox")
  expectCspToken(firefoxManifest, "ws://*:*", "Firefox")
  expectCspToken(firefoxManifest, "wss://*:*", "Firefox")

  console.log("\n✅ Browser smoke verification passed")
  console.log(
    "   Chrome/Firefox manifests, entry surfaces, CSP connect-src, and browser-specific permissions are valid."
  )
}

main()
