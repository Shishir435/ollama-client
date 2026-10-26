import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { basename, join } from "node:path"
import { expect, test } from "vitest"
import { eagerPageFiles } from "../../tools/checks/eager-page-files"

test("counts transitive eager edges, cycles and shared preloads once while excluding lazy assets", () => {
  const root = mkdtempSync(join(tmpdir(), "eager-bundle-"))
  try {
    const files = {
      "page.html": `<script type="module" src="/entry.js"></script><link rel="modulepreload" href="/shared.js"><link rel="stylesheet" href="/style.css"><link rel="icon" href="/icon.svg">`,
      "entry.js": `import './shared.js'; export { value } from './transitive.js'; import('./lazy.js'); const text = "import './missing.js'"`,
      "shared.js": `import './transitive.js'`,
      "transitive.js": `import './entry.js'; export const value = 1`,
      "style.css": "body{}",
      "lazy.js": "",
      "icon.svg": ""
    }
    for (const [name, content] of Object.entries(files))
      writeFileSync(join(root, name), content)
    expect(
      eagerPageFiles(root, "page.html")
        .map((file) => basename(file))
        .sort()
    ).toEqual([
      "entry.js",
      "page.html",
      "shared.js",
      "style.css",
      "transitive.js"
    ])
    rmSync(join(root, "shared.js"))
    expect(() => eagerPageFiles(root, "page.html")).toThrow(
      "Missing eager asset"
    )
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
