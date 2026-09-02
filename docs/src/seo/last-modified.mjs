/**
 * Per-page last-modified dates for the sitemap, read from git history.
 *
 * The sitemap previously carried no `lastmod` at all, which tells crawlers
 * nothing about which of ~18 indexable pages actually changed. Starlight
 * already derives a "Last updated" date from git for its footer; this reads the
 * same underlying source so the two cannot disagree.
 *
 * Deliberately fails silent-but-empty rather than approximate. Filesystem
 * mtimes are the tempting fallback and would be wrong: a CI checkout stamps
 * every file with the checkout time, which would advertise the whole site as
 * modified on every deploy. An absent `lastmod` is a missing hint; a wrong one
 * is a lie that trains crawlers to ignore the field.
 *
 * Shallow clones (Vercel's default) simply yield fewer entries: `--name-only`
 * lists the files each available commit touched, so pages outside that window
 * are omitted instead of misdated.
 */
import { execFileSync } from "node:child_process"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../..")
const CONTENT_PREFIX = "docs/src/content/docs/"

const slugFromRepoPath = (path) => {
  if (!path.startsWith(CONTENT_PREFIX)) return undefined
  const withoutExt = path
    .slice(CONTENT_PREFIX.length)
    .replace(/\.(md|mdx)$/, "")
  if (withoutExt === path.slice(CONTENT_PREFIX.length)) return undefined
  return withoutExt.endsWith("/index")
    ? withoutExt.slice(0, -"/index".length)
    : withoutExt
}

const git = (args) => {
  try {
    return execFileSync("git", ["-C", REPO_ROOT, ...args], {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"]
    })
  } catch {
    // No git, no history, or a non-repo export. Emit no lastmod at all.
    return ""
  }
}

const readGitLog = () =>
  git(["log", "--pretty=format:@%cI", "--name-only", "--", CONTENT_PREFIX])

/**
 * Pages whose content is not a tracked file under the docs content tree, mapped
 * to the paths that actually determine them.
 *
 * Without this the four most-linked URLs on the site — the landing page above
 * all — would be the ones missing a date, because `/` and `/goodbye/` are Astro
 * pages rather than content entries, and `about/changelog` and
 * `concepts/provider-matrix` are build outputs (gitignored, so the generated
 * file itself has no history). Dating them by their real sources is accurate;
 * omitting them would have quietly excluded exactly the pages that matter most.
 */
const SLUG_SOURCES = {
  "": ["docs/src/pages/index.astro"],
  goodbye: ["docs/src/pages/goodbye.astro"],
  "about/changelog": ["CHANGELOG.md"],
  // Regenerated from the provider implementations by tools/generate/generate-docs.ts, so
  // the matrix is as current as the newest change in that directory.
  "concepts/provider-matrix": ["src/lib/providers"]
}

const newestCommitDate = (paths) => {
  const date = git(["log", "-1", "--pretty=format:%cI", "--", ...paths]).trim()
  return date || undefined
}

const buildMap = () => {
  const dates = new Map()
  let current

  for (const line of readGitLog().split("\n")) {
    if (line.startsWith("@")) {
      current = line.slice(1).trim()
      continue
    }
    const path = line.trim()
    if (!path || !current) continue
    const slug = slugFromRepoPath(path)
    // git log walks newest-first, so the first date seen for a file is its
    // most recent change. Later (older) commits must not overwrite it.
    if (slug && !dates.has(slug)) dates.set(slug, current)
  }

  // Explicit sources win: a generated content file may exist on disk with no
  // history, and for the two Astro pages there is no content file at all.
  for (const [slug, paths] of Object.entries(SLUG_SOURCES)) {
    const date = newestCommitDate(paths)
    if (date) dates.set(slug, date)
  }

  return dates
}

const lastModifiedBySlug = buildMap()

/**
 * Resolve a built page URL to its slug and return that page's date. The landing
 * page resolves to the empty slug. Returns undefined for generated reference
 * pages and anything else with no tracked source.
 */
export const lastModifiedForUrl = (url) =>
  lastModifiedBySlug.get(new URL(url).pathname.replace(/^\/|\/$/g, ""))
