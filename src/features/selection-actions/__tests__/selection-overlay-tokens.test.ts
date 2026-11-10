import { readFileSync } from "node:fs"
import { join } from "node:path"
import tailwind from "@tailwindcss/postcss"
import postcss from "postcss"
import { describe, expect, it } from "vitest"
import { buildShadowStyles } from "../overlay-shadow-styles"

const sourceRoot = join(process.cwd(), "src")
const read = (path: string) => readFileSync(join(sourceRoot, path), "utf8")

const tokens = read("theme-tokens.css")
const globals = read("globals.css")
const overlayCss = read("features/selection-actions/selection-overlay.css")

/**
 * The overlay pins these to px so a rem-based host page cannot resize it.
 * They are sizes, not colors, and the only shared names it may redeclare.
 */
const OVERLAY_PX_PINS = new Set([
  "--radius",
  "--radius-control",
  "--radius-panel",
  "--radius-chip",
  "--control-height-xs",
  "--control-height-sm",
  "--control-height-md",
  "--control-height-lg"
])

/**
 * Custom properties a stylesheet assigns a value to. `@theme` blocks are left
 * out: their `--radius-control: var(--radius-control)` lines tell Tailwind a
 * utility exists and define no value of their own.
 */
const declaredProperties = (css: string): Set<string> =>
  new Set(
    Array.from(
      css
        .replace(/@theme[^{]*\{[^}]*\}/g, "")
        .matchAll(/(?:^|[\s;{])(--[\w-]+)\s*:/g),
      (match) => match[1]
    )
  )

const sharedTokens = declaredProperties(tokens)

describe("selection overlay theme tokens", () => {
  it("defines every token once, for the app's pages and the overlay's shadow root", () => {
    expect(tokens).toMatch(/^:root,\n#selection-actions-root \{$/m)
    expect(tokens).toMatch(/^\.dark,\n#selection-actions-root\.dark \{$/m)
    expect(sharedTokens.has("--background")).toBe(true)
    expect(sharedTokens.has("--destructive")).toBe(true)
  })

  it("declares the overlay's tokens inside the shadow root, out of the page's reach", () => {
    /**
     * The host element lives in the page's tree, so a page rule such as
     * `* { --background: red }` matches it and beats any `:host` rule. Only an
     * element inside the shadow root is beyond every page selector.
     */
    const selectors = Array.from(
      tokens.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/([^{}]+)\{/g),
      (match) => match[1].trim()
    )
    expect(selectors).toHaveLength(2)
    for (const selector of selectors) {
      expect(selector).not.toContain(":host")
      expect(selector).toContain("#selection-actions-root")
    }
  })

  it("is the stylesheet both the app and the overlay import", () => {
    expect(globals).toContain('@import "./theme-tokens.css";')
    expect(overlayCss).toContain('@import "../../theme-tokens.css";')
  })

  it("leaves no second copy of a token to drift", () => {
    const redeclared = (css: string, allowed = new Set<string>()) =>
      [...declaredProperties(css)].filter(
        (name) => sharedTokens.has(name) && !allowed.has(name)
      )

    expect(redeclared(globals)).toEqual([])
    expect(redeclared(overlayCss)).toEqual([])
    expect(redeclared(buildShadowStyles(""), OVERLAY_PX_PINS)).toEqual([])
  })

  it("keeps the overlay's 16px base and px pins inside the shadow root", () => {
    const styles = buildShadowStyles("")
    expect(styles).toMatch(/#selection-actions-root \{\s*font-size: 16px;/)
    expect(styles).toContain("--spacing: 4px;")
    expect(styles).not.toMatch(/--radius[\w-]*:\s*[\d.]+rem/)
    for (const [size, pixels] of Object.entries({
      xs: 20,
      sm: 24,
      md: 28,
      lg: 32
    })) {
      expect(styles).toContain(`--control-height-${size}: ${pixels}px;`)
    }
    for (const [size, pixels] of Object.entries({
      micro: 10,
      xs: 12,
      sm: 14,
      md: 16
    })) {
      expect(styles).toContain(`--icon-${size}: ${pixels}px;`)
    }
  })

  it("compiles the shared button's control sizes in the isolated overlay stylesheet", async () => {
    const result = await postcss([tailwind()]).process(overlayCss, {
      from: join(sourceRoot, "features/selection-actions/selection-overlay.css")
    })
    const rules = new Map<string, string>()
    result.root.walkRules((rule) => {
      rules.set(rule.selector, rule.toString())
    })
    expect(rules.get(".size-control-md")).toContain(
      "width: var(--control-height-md)"
    )
    expect(rules.get(".size-control-sm")).toContain(
      "height: var(--control-height-sm)"
    )
    expect(rules.get(".h-control-sm")).toContain(
      "height: var(--control-height-sm)"
    )
  })
})
