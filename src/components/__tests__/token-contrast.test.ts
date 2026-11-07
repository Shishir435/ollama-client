import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"

const css = readFileSync(resolve(__dirname, "../../theme-tokens.css"), "utf8")
const darkAt = css.indexOf("\n.dark,")
const blocks = {
  light: css.slice(css.indexOf(":root,"), darkAt),
  dark: css.slice(darkAt)
}

const lin = (c: number) =>
  c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
const gam = (c: number) =>
  c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055

/** Linear sRGB of an `oklch(...)` or `hsl(...)` token value, plus its alpha. */
function parse(value: string): { rgb: number[]; alpha: number } {
  const m = value.match(/(oklch|hsl)\(([^)]+)\)/)
  if (!m) throw new Error(`unparsable color: ${value}`)
  const [color, alphaPart] = m[2].split("/")
  const n = color.trim().split(/\s+/).map(parseFloat)
  const alpha = alphaPart ? parseFloat(alphaPart) / 100 : 1
  if (m[1] === "hsl") {
    const [h, s, l] = [n[0], n[1] / 100, n[2] / 100]
    const a = s * Math.min(l, 1 - l)
    const f = (k: number) => {
      const q = (k + h / 30) % 12
      return l - a * Math.max(-1, Math.min(q - 3, 9 - q, 1))
    }
    return { rgb: [f(0), f(8), f(4)].map(lin), alpha }
  }
  const [L, C, h] = n
  const a = C * Math.cos((h * Math.PI) / 180)
  const b = C * Math.sin((h * Math.PI) / 180)
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3
  const mm = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3
  const rgb = [
    4.0767416621 * l - 3.3077115913 * mm + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * mm - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * mm + 1.707614701 * s
  ].map((x) => Math.min(1, Math.max(0, x)))
  return { rgb, alpha }
}

function token(theme: "light" | "dark", name: string) {
  const m = blocks[theme].match(new RegExp(`--${name}:\\s*([^;]+);`))
  if (!m) throw new Error(`--${name} missing in ${theme}`)
  return m[1]
}

function over(fg: string, bg: string) {
  const f = parse(fg)
  const b = parse(bg).rgb
  return f.rgb.map((v, i) => lin(gam(v) * f.alpha + gam(b[i]) * (1 - f.alpha)))
}

const luminance = ([r, g, b]: number[]) => 0.2126 * r + 0.7152 * g + 0.0722 * b
function ratio(theme: "light" | "dark", fg: string, bg = "background") {
  const bgRgb = parse(token(theme, bg)).rgb
  const a = luminance(over(token(theme, fg), token(theme, bg)))
  const b = luminance(bgRgb)
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
}

describe.each(["light", "dark"] as const)("token contrast (%s)", (theme) => {
  it("keeps the focus ring and control stroke at 3:1", () => {
    expect(ratio(theme, "ring")).toBeGreaterThanOrEqual(3)
    expect(ratio(theme, "stroke-control")).toBeGreaterThanOrEqual(3)
  })

  it.each(["success", "warning", "info", "danger"])(
    "keeps %s text at 4.5:1",
    (status) => {
      expect(ratio(theme, `status-${status}-text`)).toBeGreaterThanOrEqual(4.5)
    }
  )

  it("keeps destructive and success fills readable with their foreground", () => {
    expect(
      ratio(theme, "destructive-foreground", "destructive")
    ).toBeGreaterThanOrEqual(4.5)
    expect(
      ratio(theme, "status-success-foreground", "status-success")
    ).toBeGreaterThanOrEqual(4.5)
  })
})

/** The OKLCH lightness of a token's value; the figure the surface steps are tuned in. */
const lightness = (theme: "light" | "dark", name: string) =>
  parseFloat(token(theme, name).match(/oklch\(\s*([\d.]+)/)![1])

describe("dark surface separation", () => {
  /**
   * Chat is the floor; every surface drawn directly on or beside it must step
   * away by this much lightness, or the panes read as one slab. 0.04 is the
   * smallest step that stayed distinguishable on a dim laptop panel.
   */
  const MIN_STEP = 0.04

  it.each(["surface-sidebar", "surface-composer", "surface-message"])(
    "keeps %s a visible step from the chat surface",
    (name) => {
      expect(
        lightness("dark", name) - lightness("dark", "surface-chat")
      ).toBeGreaterThanOrEqual(MIN_STEP)
    }
  )

  it("keeps cards a visible step from the page", () => {
    expect(
      lightness("dark", "card") - lightness("dark", "background")
    ).toBeGreaterThanOrEqual(MIN_STEP)
  })

  it.each(["surface-sidebar", "surface-composer", "surface-message"])(
    "keeps the strong stroke visible against %s",
    (name) => {
      expect(ratio("dark", "stroke-strong", name)).toBeGreaterThanOrEqual(1.3)
    }
  )
})
