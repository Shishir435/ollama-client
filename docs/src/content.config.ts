import { docsLoader } from "@astrojs/starlight/loaders"
import { docsSchema } from "@astrojs/starlight/schema"
import { defineCollection } from "astro:content"

/**
 * Starlight content collection. Pages live under
 * `src/content/docs/<group>/<slug>.md(x)` and are routed at
 * `/<group>/<slug>/` by the Starlight integration.
 */
export const collections = {
  docs: defineCollection({
    loader: docsLoader(),
    schema: docsSchema()
  })
}
