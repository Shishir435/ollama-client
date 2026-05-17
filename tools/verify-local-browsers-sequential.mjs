#!/usr/bin/env node

import { execSync } from "node:child_process"

const run = (name, command) => {
  console.log(`\n=== ${name} ===`)
  console.log(`$ ${command}`)
  execSync(command, { stdio: "inherit" })
}

const main = () => {
  run("Chrome target", "pnpm build")
  run("Firefox target", "pnpm build:firefox")
  run("Manifest/CSP smoke", "pnpm verify:browser-smoke")
  run("Unit and integration tests", "pnpm test:run")

  console.log("\n✅ Local sequential browser verification passed")
}

main()
