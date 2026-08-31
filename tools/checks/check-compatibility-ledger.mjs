import { access, readFile } from "node:fs/promises"

const LEDGER_URL = new URL("../../compatibility-ledger.json", import.meta.url)
const REQUIRED_FIELDS = [
  "id",
  "owner",
  "introducedIn",
  "sourceVersions",
  "removalGate",
  "targetRelease",
  "recoveryPath"
]

const fail = (message) => {
  throw new Error(`Invalid compatibility ledger: ${message}`)
}

const ledger = JSON.parse(await readFile(LEDGER_URL, "utf8"))

if (ledger.version !== 1) fail("version must be 1")
if (!Array.isArray(ledger.entries) || ledger.entries.length === 0) {
  fail("entries must be a non-empty array")
}

const ids = new Set()
for (const [index, entry] of ledger.entries.entries()) {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
    fail(`entry ${index} must be an object`)
  }
  for (const field of REQUIRED_FIELDS) {
    if (!(field in entry)) fail(`entry ${index} is missing ${field}`)
  }
  if (typeof entry.id !== "string" || !/^[a-z0-9-]+$/.test(entry.id)) {
    fail(`entry ${index} has an invalid id`)
  }
  if (ids.has(entry.id)) fail(`duplicate id ${entry.id}`)
  ids.add(entry.id)

  for (const field of [
    "owner",
    "introducedIn",
    "removalGate",
    "recoveryPath"
  ]) {
    if (typeof entry[field] !== "string" || entry[field].trim() === "") {
      fail(`${entry.id}.${field} must be a non-empty string`)
    }
  }
  if (
    !Array.isArray(entry.sourceVersions) ||
    entry.sourceVersions.length === 0 ||
    entry.sourceVersions.some(
      (version) => typeof version !== "string" || version.trim() === ""
    )
  ) {
    fail(`${entry.id}.sourceVersions must contain non-empty strings`)
  }
  if (
    entry.targetRelease !== null &&
    (typeof entry.targetRelease !== "string" ||
      entry.targetRelease.trim() === "")
  ) {
    fail(`${entry.id}.targetRelease must be a string or null`)
  }
  try {
    await access(new URL(`../../${entry.owner}`, import.meta.url))
  } catch {
    fail(`${entry.id}.owner does not exist: ${entry.owner}`)
  }
}

console.log(`Compatibility ledger valid (${ledger.entries.length} entries).`)
