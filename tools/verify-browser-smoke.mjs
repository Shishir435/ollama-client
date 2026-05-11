#!/usr/bin/env node

import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { execSync } from "node:child_process"

const rootDir = process.cwd()

const run = (command) => {
  console.log(`\n▶ ${command}`)
  execSync(command, {
    cwd: rootDir,
    stdio: "inherit"
  })
}

const readManifest = (relativePath) => {
  const absolutePath = resolve(rootDir, relativePath)
  return JSON.parse(readFileSync(absolutePath, "utf8"))
}

const assert = (condition, message) => {
  if (!condition) {
    throw new Error(message)
  }
}

const expectPermission = (manifest, permission, browserName) => {
  const permissions = manifest.permissions || []
  assert(
    permissions.includes(permission),
    `${browserName} manifest missing permission: ${permission}`
  )
}

const expectNoPermission = (manifest, permission, browserName) => {
  const permissions = manifest.permissions || []
  assert(
    !permissions.includes(permission),
    `${browserName} manifest should not include permission: ${permission}`
  )
}

const expectHostPermission = (manifest, hostPermission, browserName) => {
  const hostPermissions =
    manifest.manifest_version === 2
      ? manifest.permissions || []
      : manifest.host_permissions || []
  assert(
    hostPermissions.includes(hostPermission),
    `${browserName} manifest missing host permission: ${hostPermission}`
  )
}

const expectCspToken = (manifest, token, browserName) => {
  const extensionPages =
    typeof manifest.content_security_policy === "string"
      ? manifest.content_security_policy
      : manifest.content_security_policy?.extension_pages || ""
  assert(
    extensionPages.includes(token),
    `${browserName} CSP extension_pages missing token: ${token}`
  )
}

const main = () => {
  run("pnpm build")
  run("pnpm build:firefox")
  run("bash tools/post-firefox-manifest.sh")

  const chromeManifest = readManifest("build/chrome-mv3-prod/manifest.json")
  const firefoxManifest = readManifest("build/firefox-mv2-prod/manifest.json")

  expectHostPermission(chromeManifest, "<all_urls>", "Chrome")
  expectHostPermission(firefoxManifest, "<all_urls>", "Firefox")

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
    "   Chrome/Firefox manifests, CSP connect-src, and browser-specific permissions are valid."
  )
}

main()
