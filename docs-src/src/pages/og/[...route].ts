import { OGImageRoute } from "astro-og-canvas"
import { LANDING_TITLE, LANDING_DESCRIPTION } from "@/seo/constants.mjs"

type MarkdownModule = {
  frontmatter: { title?: string; description?: string }
}

const docFiles = import.meta.glob<MarkdownModule>(
  "/src/content/docs/**/*.{md,mdx}",
  { eager: true },
)

const pages = Object.fromEntries(
    const slug = path
      .replace("/src/content/docs/", "")
      .replace(/\/index\.mdx?$/, "")
      .replace(/\.mdx?$/, "")
)

pages.index = {
  title: LANDING_TITLE,
  description: LANDING_DESCRIPTION,
}

export const { getStaticPaths, GET } = await OGImageRoute({
  param: "route",
  pages,
  getImageOptions: (_path, page) => ({
    title: page.title,
    description: page.description,
    bgGradient: [[10, 10, 11], [23, 23, 27]],
    border: {
      color: [63, 63, 70],
      width: 3,
      side: "inline-start",
    },
    font: {
      title: {
        color: [250, 250, 250],
        size: 64,
        weight: "Bold",
      },
      description: {
        color: [161, 161, 170],
        size: 32,
      },
    },
    padding: 60,
  }),
})
