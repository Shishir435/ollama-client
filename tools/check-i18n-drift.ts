/**
 * i18n drift gate (v0.11.0 groundwork — FEATURE_ROADMAP §5 item 6).
 *
 * `en` is the reference locale. Every other locale must define the same set of
 * leaf keys. This reports keys MISSING from a locale (untranslated / stale) and,
 * separately, EXTRA keys not present in `en` (likely renamed/removed in en but
 * left behind in the locale). Extra keys warn only.
 *
 * All locales are fully translated, so `pnpm check:i18n` runs in `--strict` mode
 * (fails on ANY missing key) to keep it that way. Add an `en` key without
 * translating it for every locale and this fails — translate the new keys (or
 * temporarily run without `--strict`) rather than letting a backlog accumulate.
 *
 * Run: pnpm check:i18n            (strict — fails on any missing key)
 *      npx tsx tools/check-i18n-drift.ts   (warn-only — report without failing)
 */

import fs from "fs"
import path from "path"
import { fileURLToPath } from "url"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const LOCALES_DIR = path.join(__dirname, "../src/locales")
const REFERENCE_LOCALE = "en"

type Json = Record<string, unknown>

/** Flatten a nested translation object to a set of dot-joined leaf keys. */
function flattenKeys(obj: Json, prefix = "", out = new Set<string>()): Set<string> {
  for (const [key, value] of Object.entries(obj)) {
    const full = prefix ? `${prefix}.${key}` : key
    if (value && typeof value === "object" && !Array.isArray(value)) {
      flattenKeys(value as Json, full, out)
    } else {
      out.add(full)
    }
  }
  return out
}

function loadLocale(locale: string): Set<string> {
  const file = path.join(LOCALES_DIR, locale, "translation.json")
  const raw = fs.readFileSync(file, "utf-8")
  return flattenKeys(JSON.parse(raw) as Json)
}

function main(): void {
  const strict = process.argv.includes("--strict")
  const locales = fs
    .readdirSync(LOCALES_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)

  if (!locales.includes(REFERENCE_LOCALE)) {
    console.error(`Reference locale "${REFERENCE_LOCALE}" not found in ${LOCALES_DIR}`)
    process.exit(1)
  }

  const reference = loadLocale(REFERENCE_LOCALE)
  let hasMissing = false

  for (const locale of locales.filter((l) => l !== REFERENCE_LOCALE).sort()) {
    const keys = loadLocale(locale)
    const missing = [...reference].filter((k) => !keys.has(k)).sort()
    const extra = [...keys].filter((k) => !reference.has(k)).sort()

    const pct = Math.round(((reference.size - missing.length) / reference.size) * 100)
    console.log(`\n${locale}: ${pct}% translated (${missing.length} missing, ${extra.length} extra of ${reference.size})`)

    if (missing.length > 0) {
      hasMissing = true
      for (const k of missing.slice(0, 25)) console.log(`  - missing: ${k}`)
      if (missing.length > 25) console.log(`  …and ${missing.length - 25} more`)
    }
    if (extra.length > 0) {
      for (const k of extra.slice(0, 25)) console.log(`  ~ extra:   ${k}`)
      if (extra.length > 25) console.log(`  …and ${extra.length - 25} more`)
    }
  }

  if (hasMissing) {
    const msg = `i18n drift: one or more locales are missing keys present in "${REFERENCE_LOCALE}".`
    if (strict) {
      console.error(`\n✗ ${msg}`)
      process.exit(1)
    }
    console.warn(`\n⚠ ${msg} (warn mode — run with --strict to fail CI)`)
    return
  }
  console.log(`\n✓ All locales cover every "${REFERENCE_LOCALE}" key.`)
}

main()
