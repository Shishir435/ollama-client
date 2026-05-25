import fs from "fs"
import path from "path"
import { fileURLToPath } from "url"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const LOCALES_DIR = path.join(__dirname, "../src/locales")
const SOURCE_LOCALE = "en"
const SHOULD_WRITE = process.argv.includes("--write")

type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue }

function isRecord(value: JsonValue): value is { [key: string]: JsonValue } {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function typeOf(value: JsonValue) {
  if (Array.isArray(value)) {
    return "array"
  }

  if (value === null) {
    return "null"
  }

  return typeof value
}

function readTranslation(locale: string) {
  const file = path.join(LOCALES_DIR, locale, "translation.json")
  return JSON.parse(fs.readFileSync(file, "utf-8")) as JsonValue
}

function flatten(value: JsonValue, prefix = "") {
  const entries = new Map<string, string>()
  const key = prefix || "<root>"
  const currentType = typeOf(value)
  entries.set(key, currentType)

  if (isRecord(value)) {
    for (const childKey of Object.keys(value)) {
      const childPath = prefix ? `${prefix}.${childKey}` : childKey
      for (const entry of flatten(value[childKey], childPath)) {
        entries.set(entry[0], entry[1])
      }
    }
  }

  return entries
}

function syncToSourceShape(source: JsonValue, target: JsonValue): JsonValue {
  if (!isRecord(source)) {
    return typeOf(source) === typeOf(target) ? target : source
  }

  if (!isRecord(target)) {
    return source
  }

  const next: { [key: string]: JsonValue } = {}

  for (const key of Object.keys(source)) {
    next[key] = syncToSourceShape(source[key], target[key])
  }

  return next
}

function diffAgainstSource(source: JsonValue, target: JsonValue) {
  const sourceMap = flatten(source)
  const targetMap = flatten(target)

  return {
    missing: [...sourceMap.keys()].filter((key) => !targetMap.has(key)),
    extra: [...targetMap.keys()].filter((key) => !sourceMap.has(key)),
    mismatched: [...sourceMap.keys()].filter((key) => {
      return targetMap.has(key) && targetMap.get(key) !== sourceMap.get(key)
    })
  }
}

function formatList(items: string[]) {
  return items
    .slice(0, 25)
    .map((item) => `    - ${item}`)
    .join("\n")
}

function main() {
  const source = readTranslation(SOURCE_LOCALE)
  const locales = fs
    .readdirSync(LOCALES_DIR)
    .filter((item) => {
      return (
        item !== SOURCE_LOCALE &&
        fs.statSync(path.join(LOCALES_DIR, item)).isDirectory()
      )
    })
    .sort()

  let hasDrift = false

  for (const locale of locales) {
    const target = readTranslation(locale)
    const diff = diffAgainstSource(source, target)
    const driftCount =
      diff.missing.length + diff.extra.length + diff.mismatched.length

    if (driftCount === 0) {
      console.log(`✓ ${locale} matches ${SOURCE_LOCALE}`)
      continue
    }

    hasDrift = true
    console.log(`✗ ${locale} differs from ${SOURCE_LOCALE}`)
    console.log(`  missing: ${diff.missing.length}`)
    if (diff.missing.length > 0) {
      console.log(formatList(diff.missing))
    }
    console.log(`  extra: ${diff.extra.length}`)
    if (diff.extra.length > 0) {
      console.log(formatList(diff.extra))
    }
    console.log(`  type mismatches: ${diff.mismatched.length}`)
    if (diff.mismatched.length > 0) {
      console.log(formatList(diff.mismatched))
    }

    if (SHOULD_WRITE) {
      const file = path.join(LOCALES_DIR, locale, "translation.json")
      fs.writeFileSync(
        file,
        `${JSON.stringify(syncToSourceShape(source, target), null, 2)}\n`
      )
      console.log(`  wrote ${file}`)
    }
  }

  if (hasDrift && !SHOULD_WRITE) {
    console.error(
      `\nLocale files are out of sync. Run pnpm i18n:sync to derive their key shape from ${SOURCE_LOCALE}.`
    )
    process.exit(1)
  }
}

main()
