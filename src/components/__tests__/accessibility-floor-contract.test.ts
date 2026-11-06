import { readdirSync, readFileSync, statSync } from "node:fs"
import { join, relative } from "node:path"
import ts from "typescript"
import { describe, expect, it } from "vitest"

const repoRoot = process.cwd()
const sourceRoot = join(repoRoot, "src")

const listTsx = (dir: string): string[] => {
  const files: string[] = []
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry)
    if (relative(sourceRoot, path).includes("__tests__")) continue
    if (statSync(path).isDirectory()) files.push(...listTsx(path))
    else if (path.endsWith(".tsx")) files.push(path)
  }
  return files
}

const files = listTsx(sourceRoot)
const rel = (path: string) => relative(repoRoot, path)

/** The `--text-*` sizes the stylesheet defines, in pixels. */
const textSizes = (): Record<string, number> => {
  const css = readFileSync(join(sourceRoot, "globals.css"), "utf8")
  const sizes: Record<string, number> = {}
  for (const match of css.matchAll(/--text-([a-z0-9]+):\s*([\d.]+)rem;/g)) {
    sizes[match[1]] = parseFloat(match[2]) * 16
  }
  return sizes
}

describe("minimum text size", () => {
  /**
   * The floor for text a person reads is 11px (`text-micro`). `text-nano`
   * (10px) exists only for a count inside a badge a few pixels wide, where the
   * number is also stated in an accessible name; anything else uses a larger
   * size. If you need a new entry here, the text probably wants `text-micro`.
   */
  const READABLE_FLOOR_PX = 11
  const NANO_FLOOR_PX = 10
  const NANO_ALLOWLIST = new Set([
    "src/components/icon-badge.tsx",
    "src/features/chat/components/chat-input/context-settings-menu.tsx",
    "src/features/chat/components/unified-sources-sheet.tsx"
  ])

  it("defines no readable size below the floor", () => {
    const sizes = textSizes()
    expect(sizes.nano).toBeGreaterThanOrEqual(NANO_FLOOR_PX)
    for (const name of ["micro", "2xs", "xs", "sm", "base"]) {
      expect(sizes[name], name).toBeGreaterThanOrEqual(READABLE_FLOOR_PX)
    }
  })

  it("uses text-nano only in the badge-count allowlist", () => {
    const offenders = files
      .filter((path) => /\btext-nano\b/.test(readFileSync(path, "utf8")))
      .map(rel)
      .filter((path) => !NANO_ALLOWLIST.has(path))
    expect(offenders).toEqual([])
  })
})

/** Every string literal and template chunk in a file, with its line. */
const stringsOf = (path: string): Array<{ text: string; line: number }> => {
  const text = readFileSync(path, "utf8")
  const source = ts.createSourceFile(
    path,
    text,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX
  )
  const found: Array<{ text: string; line: number }> = []
  const visit = (node: ts.Node) => {
    if (
      ts.isStringLiteral(node) ||
      ts.isNoSubstitutionTemplateLiteral(node) ||
      ts.isTemplateHead(node) ||
      ts.isTemplateMiddle(node) ||
      ts.isTemplateTail(node)
    ) {
      found.push({
        text: node.text,
        line: source.getLineAndCharacterOfPosition(node.getStart()).line + 1
      })
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  return found
}

describe("hover-only reveals", () => {
  /**
   * A control that is invisible until hover is invisible to a keyboard user
   * and to a touch screen. Every class string that hides with `opacity-0` and
   * reveals with a hover variant must also reveal on focus.
   */
  const HOVER_REVEAL = /(?:^|\s)(?:group-|peer-)?hover:opacity-100/
  const FOCUS_REVEAL =
    /(?:^|\s)(?:focus-visible|focus-within|group-focus-within|group-focus-visible|focus|peer-focus-visible):opacity-100/
  /** Decorative, not controls: the focusable parent already carries the meaning. */
  const ALLOWLIST = new Set([
    "src/features/chat/components/search/search-result-item.tsx:82"
  ])

  it("pairs every hover reveal with a focus reveal", () => {
    const offenders: string[] = []
    for (const path of files) {
      for (const { text, line } of stringsOf(path)) {
        if (!/\bopacity-0\b/.test(text) || !HOVER_REVEAL.test(text)) continue
        if (FOCUS_REVEAL.test(text)) continue
        const where = `${rel(path)}:${line}`
        if (!ALLOWLIST.has(where)) offenders.push(where)
      }
    }
    expect(offenders).toEqual([])
  })
})

describe("small hit targets", () => {
  /**
   * `button.tsx` grows the hit area of its `xs` and `icon-xs` sizes with a
   * `before:` pseudo-element, so a 20px glyph button still takes a 24px+
   * press. A `size-5` / `h-5` control that does not use the same pattern has a
   * 20px target and no slop.
   */
  const SMALL = /(?:^|\s)(?:size|h|w)-5(?:\s|$)/
  const HIT_SLOP = /before:(?:absolute|-inset|inset)/
  const INTERACTIVE = new Set(["Button", "button", "TooltipActionButton"])
  /** Decorative or inside a larger target; each states why. */
  const ALLOWLIST = new Set<string>([])

  it("gives every size-5 control the button hit-slop pattern", () => {
    const offenders: string[] = []
    for (const path of files) {
      const text = readFileSync(path, "utf8")
      const source = ts.createSourceFile(
        path,
        text,
        ts.ScriptTarget.Latest,
        true,
        ts.ScriptKind.TSX
      )
      const visit = (node: ts.Node) => {
        if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
          const tag = node.tagName.getText(source)
          const attr = node.attributes.properties.find(
            (a): a is ts.JsxAttribute =>
              ts.isJsxAttribute(a) && a.name.getText(source) === "className"
          )
          const classes = attr?.initializer?.getText(source) ?? ""
          if (
            INTERACTIVE.has(tag) &&
            SMALL.test(classes.replace(/["'`{}]/g, " ")) &&
            !HIT_SLOP.test(classes)
          ) {
            const where = `${rel(path)}:${source.getLineAndCharacterOfPosition(node.getStart()).line + 1}`
            if (!ALLOWLIST.has(where)) offenders.push(where)
          }
        }
        ts.forEachChild(node, visit)
      }
      visit(source)
    }
    expect(offenders).toEqual([])
  })
})
