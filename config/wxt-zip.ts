import type { defineConfig } from "wxt"

type WxtZip = NonNullable<Parameters<typeof defineConfig>[0]["zip"]>

/**
 * What the store packages leave out.
 *
 * The Firefox and Opera packages carry a sources archive of the repository,
 * and WXT builds it from the working tree without reading `.gitignore`. Local
 * output that is ignored in git therefore went into it: benchmark evidence
 * under `artifacts/` holds page captures and run logs, and at two gigabytes it
 * ran `pnpm package:firefox` out of memory before the archive was written.
 */
export const zip: WxtZip = {
  exclude: ["assets/icon-promo-light.png"],
  excludeSources: ["artifacts/**", "coverage/**", "agent-*.json"]
}
