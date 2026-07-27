#!/usr/bin/env tsx

/**
 * Run the CI check job against a pristine checkout of HEAD.
 *
 * Why this exists: `pnpm test:run` in your working tree sees files CI never
 * has. Several build artifacts are gitignored on purpose —
 * `docs/src/content/docs/about/changelog.md`,
 * `docs/src/content/docs/concepts/provider-matrix.md`,
 * `docs/src/content/docs/reference/`, `docs/public/llms*.txt` — and once a
 * `pnpm docs:build` has written them they stay written. A test that reads the
 * docs content tree therefore passes locally forever and fails on the first
 * fresh checkout. That is exactly how the IA drift test got through pre-push
 * and broke CI: locally the two generated pages were on disk, in CI they were
 * not.
 *
 * The fix is to check out HEAD into a throwaway worktree, which carries only
 * committed files, and run the same steps in the same order as
 * .github/workflows/ci.yml's `checks` job. node_modules is symlinked rather
 * than reinstalled — pnpm's layout is self-contained, and an install here would
 * cost minutes to verify a lockfile CI verifies anyway.
 *
 * Scope: this tests HEAD, not your uncommitted work. That matches what a push
 * actually sends, so commit first, then run it.
 *
 * Usage: pnpm verify:ci-parity
 */

import { execFileSync, spawnSync } from "node:child_process"
import { existsSync, mkdtempSync, rmSync, symlinkSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"

const REPO_ROOT = resolve(import.meta.dirname, "..")

/*
 * Mirrors the `checks` job. `pnpm install --frozen-lockfile` is represented by
 * generate:resources alone: its only effect this suite depends on is the
 * `prepare` hook writing the gitignored src/i18n/resources.ts.
 */
const STEPS: ReadonlyArray<{ name: string; args: string[] }> = [
  { name: "Generate resources (install prepare hook)", args: ["generate:resources"] },
  { name: "Typecheck", args: ["typecheck"] },
  { name: "Lint", args: ["lint:check"] },
  { name: "Format check", args: ["format:check"] },
  { name: "Tests", args: ["test:run"] }
]

const git = (...args: string[]): string =>
  execFileSync("git", args, { cwd: REPO_ROOT, encoding: "utf-8" }).trim()

const head = git("rev-parse", "--short", "HEAD")
const dirty = git("status", "--porcelain")

if (dirty) {
  console.warn(
    `Working tree has uncommitted changes. They are NOT included — this runs ${head} as pushed.\n`
  )
}

// `git worktree add` refuses a path that already exists, so mkdtemp only
// provides the parent and git creates the leaf itself.
const scratch = mkdtempSync(join(tmpdir(), "ollama-client-ci-parity-"))
const worktree = join(scratch, "repo")
let failed: string | undefined

try {
  console.log(`Checking out ${head} into ${worktree}`)
  git("worktree", "add", "--detach", "--quiet", worktree, "HEAD")

  const modules = join(REPO_ROOT, "node_modules")
  if (!existsSync(modules)) {
    throw new Error("node_modules missing — run pnpm install first")
  }
  symlinkSync(modules, join(worktree, "node_modules"), "dir")

  for (const step of STEPS) {
    console.log(`\n▸ ${step.name}`)
    const result = spawnSync("pnpm", step.args, {
      cwd: worktree,
      stdio: "inherit"
    })
    if (result.status !== 0) {
      failed = step.name
      break
    }
  }
} finally {
  rmSync(scratch, { recursive: true, force: true })
  // The worktree directory is already gone; this clears the stale admin entry.
  git("worktree", "prune")
}

if (failed) {
  console.error(`\nCI parity FAILED at: ${failed}`)
  console.error("This is what the pull request will see. Fix before pushing.")
  process.exit(1)
}

console.log(`\nCI parity passed for ${head}.`)
