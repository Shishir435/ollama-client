/**
 * Release lookup for `olc update`.
 *
 * olc is not on a registry: it ships as a checksum-verified archive attached to
 * a GitHub release, which is the same thing `olc.sh` and `olc.ps1` install. So
 * the update path asks the releases API which versions exist and where their
 * assets are, rather than assembling download URLs from a string the user typed.
 *
 * A version that does not exist is an ordinary answer here, not a failure to
 * report as one: the caller turns it into a message that names what does exist.
 */
import { isRecord, readBoundedJson } from "../util.js"
import { OLC_VERSION } from "../version.js"

export const OLC_REPO = "Shishir435/ollama-client"
const API_ROOT = "https://api.github.com"
const REQUEST_TIMEOUT_MS = 15_000
const RESPONSE_LIMIT = 1_048_576

/** Release tags are plain semver, so anything else cannot name one. */
const VERSION_TAG = /^v?\d+\.\d+\.\d+(?:-[0-9A-Za-z][0-9A-Za-z.-]*)?$/

export interface ReleaseAsset {
  name: string
  downloadUrl: string
}

export interface Release {
  version: string
  prerelease: boolean
  assets: ReleaseAsset[]
}

/** Raised when the release exists but the request could not be made or read. */
export class ReleaseLookupError extends Error {}

/** Raised when the requested version is simply not a release of this project. */
export class ReleaseNotFoundError extends Error {
  constructor(
    readonly requested: string,
    readonly available: string[]
  ) {
    super(
      available.length > 0
        ? `Version ${requested} does not exist. Recent releases: ${available.join(", ")}. Full list: https://github.com/${OLC_REPO}/releases`
        : `Version ${requested} does not exist. See https://github.com/${OLC_REPO}/releases`
    )
  }
}

export interface GithubDependencies {
  request: (path: string) => Promise<GithubResponse>
}

export interface GithubResponse {
  status: number
  rateLimited: boolean
  body: unknown
}

/** The API is read-only, unauthenticated, and identifies itself as this build. */
async function request(path: string): Promise<GithubResponse> {
  let response: Response
  try {
    response = await fetch(`${API_ROOT}${path}`, {
      headers: {
        Accept: "application/vnd.github+json",
        "User-Agent": `olc/${OLC_VERSION}`,
        "X-GitHub-Api-Version": "2022-11-28"
      },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    })
  } catch (error) {
    throw new ReleaseLookupError(
      `Could not reach GitHub: ${error instanceof Error ? error.message : "unknown network failure"}.`
    )
  }
  const rateLimited =
    response.status === 403 &&
    response.headers.get("x-ratelimit-remaining") === "0"
  if (!response.ok) {
    await response.body?.cancel()
    return { status: response.status, rateLimited, body: undefined }
  }
  return {
    status: response.status,
    rateLimited,
    body: await readBoundedJson(response, RESPONSE_LIMIT)
  }
}

const dependencies: GithubDependencies = { request }

/** Normalize what a user typed into the tag the project actually publishes. */
export function normalizeVersion(requested: string): string {
  const trimmed = requested.trim()
  if (trimmed.toLowerCase() === "latest") return "latest"
  if (!VERSION_TAG.test(trimmed))
    throw new ReleaseLookupError(
      `"${trimmed}" is not a version number. Use \`olc update\` for the latest release, or \`olc update 0.13.3\` for a specific one.`
    )
  return trimmed.replace(/^v/, "")
}

/**
 * Resolve the release to install.
 *
 * `latest` deliberately goes through the endpoint that excludes prereleases: an
 * update should not move someone onto an `-rc` build they did not ask for by
 * name.
 */
export async function resolveRelease(
  requested: string,
  deps: GithubDependencies = dependencies
): Promise<Release> {
  const version = normalizeVersion(requested)
  const path =
    version === "latest"
      ? `/repos/${OLC_REPO}/releases/latest`
      : `/repos/${OLC_REPO}/releases/tags/${encodeURIComponent(version)}`
  const response = await deps.request(path)
  if (response.status === 404)
    throw new ReleaseNotFoundError(version, await listVersions(deps))
  assertUsable(response)
  const release = toRelease(response.body)
  if (!release)
    throw new ReleaseLookupError("GitHub returned an unreadable release.")
  return release
}

/** Only used to make a missing version's message useful, so failure is silent. */
export async function listVersions(
  deps: GithubDependencies = dependencies,
  limit = 5
): Promise<string[]> {
  try {
    const response = await deps.request(
      `/repos/${OLC_REPO}/releases?per_page=20`
    )
    if (!Array.isArray(response.body)) return []
    return response.body
      .flatMap((entry) =>
        isRecord(entry) && typeof entry.tag_name === "string"
          ? [entry.tag_name]
          : []
      )
      .slice(0, limit)
  } catch {
    return []
  }
}

/** Say which wall was hit, because the remedies are completely different. */
function assertUsable(response: GithubResponse): void {
  if (response.rateLimited)
    throw new ReleaseLookupError(
      "GitHub is rate-limiting this network. Wait an hour, or reinstall from https://github.com/" +
        `${OLC_REPO}/releases`
    )
  if (response.status >= 400)
    throw new ReleaseLookupError(
      `GitHub answered ${response.status} when asked for the release.`
    )
}

/** Trust nothing about the shape of the response beyond what is read here. */
function toRelease(body: unknown): Release | undefined {
  if (!isRecord(body) || typeof body.tag_name !== "string") return undefined
  const assets = Array.isArray(body.assets) ? body.assets : []
  return {
    version: body.tag_name.replace(/^v/, ""),
    prerelease: body.prerelease === true,
    assets: assets.flatMap((asset: unknown) =>
      isRecord(asset) &&
      typeof asset.name === "string" &&
      typeof asset.browser_download_url === "string"
        ? [{ name: asset.name, downloadUrl: asset.browser_download_url }]
        : []
    )
  }
}
