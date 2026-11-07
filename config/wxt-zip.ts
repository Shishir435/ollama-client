import type { defineConfig } from "wxt"

type WxtZip = NonNullable<Parameters<typeof defineConfig>[0]["zip"]>

/**
 * What the store packages leave out.
 *
 * Firefox and Opera carry a repository sources archive, and WXT builds it
 * from the working tree without reading `.gitignore`. Ignored local outputs
 * therefore went into it: benchmark evidence under `artifacts/` holds page
 * captures and run logs, and at two gigabytes it ran `pnpm package:firefox`
 * out of memory. Generated browser builds also belong in the extension ZIPs,
 * not duplicated in the repository sources archive.
 */
export const zip: WxtZip = {
  exclude: ["assets/icon-promo-light.png"],
  excludeSources: ["artifacts/**", "build/**", "coverage/**", "agent-*.json"]
}
