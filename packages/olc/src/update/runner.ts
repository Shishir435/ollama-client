/**
 * `olc update` policy, separated from its OS effects so it can be tested without
 * downloading or replacing anything.
 *
 * The command answers one of three ways: this is already the release you asked
 * for, here is the one that would replace it, or it has been replaced. A version
 * that does not exist is not a fourth answer — it is an error, raised with the
 * versions that do exist, because guessing at what the user meant is how an
 * update lands on the wrong build.
 */
import { OLC_VERSION } from "../version.js"
import { type Release, resolveRelease } from "./github.js"
import {
  type InstallTarget,
  installRelease,
  resolveInstallTarget
} from "./install.js"

export interface UpdateOptions {
  /** `latest`, or a version the user named. */
  requested: string
  check: boolean
  json: boolean
}

export interface UpdateResult {
  command: "update"
  current: string
  requested: string
  latest: string
  status: "up-to-date" | "available" | "updated"
  message: string
}

export interface UpdateDependencies {
  resolve: (requested: string) => Promise<Release>
  target: (entry: string | undefined) => Promise<InstallTarget>
  install: (target: InstallTarget, release: Release) => Promise<void>
  entry: () => string | undefined
  current: () => string
}

const dependencies: UpdateDependencies = {
  resolve: (requested) => resolveRelease(requested),
  target: resolveInstallTarget,
  install: installRelease,
  entry: () => process.argv[1],
  current: () => OLC_VERSION
}

export async function runUpdate(
  options: UpdateOptions,
  deps: UpdateDependencies = dependencies
): Promise<UpdateResult> {
  const current = deps.current()
  const release = await deps.resolve(options.requested)
  const result = (
    status: UpdateResult["status"],
    message: string
  ): UpdateResult => ({
    command: "update",
    current,
    requested: options.requested,
    latest: release.version,
    status,
    message
  })

  if (release.version === current)
    return result(
      "up-to-date",
      options.requested === "latest"
        ? `olc ${current} is the latest release.`
        : `olc is already ${current}.`
    )

  /**
   * A build ahead of every release is a development build, and `latest` must not
   * quietly walk it backwards. Naming the older version still installs it — that
   * is a downgrade the user asked for, rather than one they were handed.
   */
  if (
    options.requested === "latest" &&
    compareVersions(current, release.version) > 0
  )
    return result(
      "up-to-date",
      `olc ${current} is newer than the latest release (${release.version}). Install that one with: olc update ${release.version}`
    )

  /** A check must not touch the installation, so it never resolves one. */
  if (options.check)
    return result(
      "available",
      `olc ${current} is installed; ${release.version} is available. Run: olc update${options.requested === "latest" ? "" : ` ${release.version}`}`
    )

  const target = await deps.target(deps.entry())
  await deps.install(target, release)
  return result(
    "updated",
    `Updated olc ${current} to ${release.version} in ${target.root}.`
  )
}

/**
 * Order two release versions.
 *
 * Only the numeric triple is compared, with a prerelease suffix sorting before
 * the release it leads to. That is all this needs to decide: whether the build
 * in hand is ahead of everything published.
 */
export function compareVersions(left: string, right: string): number {
  const parse = (value: string) => {
    const [core = "", pre] = value.split("-", 2)
    const parts = core.split(".").map((part) => Number.parseInt(part, 10) || 0)
    return { parts, prerelease: pre !== undefined }
  }
  const a = parse(left)
  const b = parse(right)
  for (let index = 0; index < 3; index++) {
    const difference = (a.parts[index] ?? 0) - (b.parts[index] ?? 0)
    if (difference !== 0) return difference > 0 ? 1 : -1
  }
  if (a.prerelease === b.prerelease) return 0
  return a.prerelease ? -1 : 1
}
