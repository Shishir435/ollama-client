import { OGImageRoute } from "astro-og-canvas"
import { LANDING_TITLE, LANDING_DESCRIPTION } from "@/seo/constants.mjs"

const keySlugs = new Set([
  "concepts/architecture",
  "concepts/provider-matrix",
  "guides/provider-setup",
  "legal/privacy-policy",
])

type MarkdownModule = {
  frontmatter: { title?: string; description?: string }
}

const docFiles = import.meta.glob(
  "/src/content/docs/**/*.{md,mdx}",
  { eager: true },
) as Record<string, MarkdownModule>

const pages: Record<string, { title: string; description: string }> = {
  index: { title: LANDING_TITLE, description: LANDING_DESCRIPTION },
}

for (const [path, mod] of Object.entries(docFiles)) {
  const slug = path
    .replace("/src/content/docs/", "")
    .replace(/\/index\.mdx?$/, "")
    .replace(/\.mdx?$/, "")
  if (keySlugs.has(slug)) {
    const { title, description } = mod.frontmatter
    pages[slug] = { title, description: description ?? "" }
  }
}

const logo = {
  path: "./public/assets/favicon-32x32.png",
  size: [32] as [width?: number, height?: number],
}

const imageOptions = {
  bgGradient: [[0, 0, 0], [8, 8, 10]] as [number, number, number][],
  fonts: [
    "https://api.fontsource.org/v1/fonts/geist/latin-700-normal.ttf",
    "https://api.fontsource.org/v1/fonts/geist/latin-400-normal.ttf",
  ],
  font: {
    title: {
      color: [255, 255, 255] as [number, number, number],
      size: 64,
      weight: "Bold" as const,
      lineHeight: 1.15,
    },
    description: {
      color: [200, 200, 205] as [number, number, number],
      size: 28,
      lineHeight: 1.4,
    },
  },
  padding: 64,
}

export const { getStaticPaths, GET } = await OGImageRoute({
  param: "route",
  pages,
  getImageOptions: (_path, page) => ({
    logo,
    ...imageOptions,
    title: page.title,
    description: page.description,
  }),
})
