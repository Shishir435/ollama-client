#!/usr/bin/env tsx

/**
 * Run CI's static checks and coverage gate in a clean checkout of HEAD.
 * Generated files and uncommitted edits in the caller's checkout are excluded.
 * Install the frozen lockfile inside the scratch checkout: symlinking the
 * caller's node_modules would resolve workspace packages back to dirty source.
 * Browser, packaging, OS-matrix and hosted CI checks remain separate gates.
 * Usage: pnpm verify:ci-parity (commit first; installation may need network).
 */
import { execFileSync, spawnSync } from "node:child_process"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"

const repoRoot = resolve(import.meta.dirname, "../..")
const git = (...args: string[]): string =>
  execFileSync("git", args, { cwd: repoRoot, encoding: "utf-8" }).trim()

const head = git("rev-parse", "HEAD")
if (git("status", "--porcelain")) {
  console.warn(
    `Uncommitted changes are excluded. Checking committed HEAD ${head}.`
  )
}

const scratch = mkdtempSync(join(tmpdir(), "ollama-client-ci-parity-"))
const worktree = join(scratch, "repo")
let added = false

try {
  git("worktree", "add", "--detach", "--quiet", worktree, head)
  added = true
  for (const args of [["install", "--frozen-lockfile"], ["verify:ci"]]) {
    console.log(`\n▸ pnpm ${args.join(" ")}`)
    const result = spawnSync("pnpm", args, { cwd: worktree, stdio: "inherit" })
    if (result.error) throw result.error
    if (result.status !== 0) {
      throw new Error(
        `pnpm ${args.join(" ")} failed (${result.signal ?? result.status})`
      )
    }
  }
  console.log(
    `\nStatic checks and coverage passed for ${head}. Browser gates were not run.`
  )
} finally {
  if (added) git("worktree", "remove", "--force", worktree)
  rmSync(scratch, { recursive: true, force: true })
}
