import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

const read = (path: string) =>
  readFileSync(join(process.cwd(), "src", path), "utf8")

type Rgb = [number, number, number]
interface Color {
  rgb: Rgb
  alpha: number
}

const clamp = (value: number) => Math.min(1, Math.max(0, value))
const encode = (value: number) =>
  value <= 0.0031308 ? 12.92 * value : 1.055 * value ** (1 / 2.4) - 0.055
const decode = (value: number) =>
  value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4

const fromOklch = (l: number, c: number, h: number): Rgb => {
  const rad = (h * Math.PI) / 180
  const a = c * Math.cos(rad)
  const b = c * Math.sin(rad)
  const lp = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3
  const mp = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3
  const sp = (l - 0.0894841775 * a - 1.291485548 * b) ** 3
  return [
    4.0767416621 * lp - 3.3077115913 * mp + 0.2309699292 * sp,
    -1.2684380046 * lp + 2.6097574011 * mp - 0.3413193965 * sp,
    -0.0041960863 * lp - 0.7034186147 * mp + 1.707614701 * sp
  ].map((v) => encode(clamp(v))) as Rgb
}

const fromHsl = (h: number, s: number, l: number): Rgb => {
  const sat = s / 100
  const light = l / 100
  const k = (n: number) => (n + h / 30) % 12
  const a = sat * Math.min(light, 1 - light)
  return [0, 8, 4].map(
    (n) => light - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)))
  ) as Rgb
}

const fromHex = (hex: string): Rgb =>
  [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255) as Rgb

const parseColor = (value: string): Color => {
  const trimmed = value.trim()
  if (trimmed.startsWith("#")) return { rgb: fromHex(trimmed), alpha: 1 }
  const match = /^(oklch|hsl)\(([^)]*)\)$/.exec(trimmed)
  if (!match) throw new Error(`Unparsed color: ${value}`)
  const [channels, alphaPart] = match[2].split("/")
  const alpha = alphaPart ? parseFloat(alphaPart) / 100 : 1
  const [x, y, z] = channels.trim().split(/\s+/).map(parseFloat)
  return {
    rgb: match[1] === "oklch" ? fromOklch(x, y, z) : fromHsl(x, y, z),
    alpha
  }
}

const over = (top: Color, bottom: Rgb): Rgb =>
  top.rgb.map((v, i) => v * top.alpha + bottom[i] * (1 - top.alpha)) as Rgb

const luminance = (rgb: Rgb) => {
  const [r, g, b] = rgb.map(decode)
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

const contrast = (a: Rgb, b: Rgb) => {
  const x = luminance(a)
  const y = luminance(b)
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05)
}

const tokensCss = read("theme-tokens.css")
const [lightBlock, darkBlock] = tokensCss.split(/^\.dark,$/m)

const tokenMap = (block: string) =>
  new Map(
    Array.from(
      block.matchAll(/(--[\w-]+):\s*([^;]+);/g),
      (match) => [match[1], match[2]] as const
    )
  )

const themes = {
  light: tokenMap(lightBlock),
  dark: new Map([...tokenMap(lightBlock), ...tokenMap(darkBlock)])
}

const token = (theme: keyof typeof themes, name: string) => {
  const value = themes[theme].get(name)
  if (!value) throw new Error(`Missing token ${name}`)
  return parseColor(value)
}

const AA = 4.5

describe.each(["light", "dark"] as const)("%s theme text contrast", (theme) => {
  const solid = (name: string) => over(token(theme, name), [0, 0, 0])
  const page = solid("--background")
  const surfaces = [
    "--background",
    "--card",
    "--popover",
    "--muted",
    "--surface-chat",
    "--surface-message",
    "--surface-sidebar",
    "--surface-composer"
  ]
  const tinted = ["--state-hover", "--state-selected", "--tint-accent"]

  it.each(["--muted-foreground", "--foreground-tertiary"])(
    "%s reads at AA on every surface it sits on",
    (name) => {
      const text = solid(name)
      for (const surface of surfaces) {
        expect(
          contrast(text, solid(surface)),
          `${name} on ${surface}`
        ).toBeGreaterThanOrEqual(AA)
      }
      for (const tint of tinted) {
        expect(
          contrast(text, over(token(theme, tint), page)),
          `${name} on ${tint}`
        ).toBeGreaterThanOrEqual(AA)
      }
    }
  )

  it("keeps tertiary text quieter than muted text", () => {
    expect(contrast(solid("--muted-foreground"), page)).toBeGreaterThan(
      contrast(solid("--foreground-tertiary"), page)
    )
  })

  it.each(["--destructive", "--status-danger"])(
    "%s text reads at AA on the danger tint",
    (name) => {
      for (const surface of ["--background", "--card"]) {
        const tint = over(token(theme, "--tint-danger"), solid(surface))
        expect(
          contrast(solid(name), tint),
          `${name} on tint over ${surface}`
        ).toBeGreaterThanOrEqual(AA)
      }
    }
  )

  it("keeps status-danger's own foreground readable on it", () => {
    expect(
      contrast(solid("--status-danger-foreground"), solid("--status-danger"))
    ).toBeGreaterThanOrEqual(AA)
  })
})

describe("code highlighting contrast", () => {
  const globals = read("globals.css")
  const lightRules = globals.slice(
    globals.indexOf("pre.hljs {"),
    globals.indexOf(".dark pre.hljs")
  )
  const colors = Array.from(
    lightRules.matchAll(/(?<!background: )\bcolor:\s*(#[0-9a-f]{6})/gi),
    (match) => match[1]
  )

  it("keeps every light token at AA on the inline code and block backgrounds", () => {
    expect(colors.length).toBeGreaterThan(5)
    const muted = over(token("light", "--muted"), [1, 1, 1])
    for (const color of colors) {
      expect(contrast(fromHex(color), muted), color).toBeGreaterThanOrEqual(AA)
      expect(
        contrast(fromHex(color), fromHex("#f6f8fa")),
        color
      ).toBeGreaterThanOrEqual(AA)
    }
  })
})
