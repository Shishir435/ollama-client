import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

const ROOT = process.cwd()

const SCOPE_AWARE_UI = [
  "src/features/chat/hooks/use-speech-settings.ts",
  "src/features/model/hooks/use-model-capability-overrides.ts",
  "src/features/permissions/components/approvals-card.tsx",
  "src/features/web-search/stores/web-search-config-store.ts"
]

describe("storage API boundary", () => {
  it("keeps migrated settings UI behind useSetting descriptors", () => {
    for (const file of SCOPE_AWARE_UI) {
      const source = readFileSync(join(ROOT, file), "utf8")
      expect(source, file).toContain('from "@/hooks/use-setting"')
      expect(source, file).not.toContain("@plasmohq/storage/hook")
      expect(source, file).not.toContain("plasmoGlobalStorage")
      expect(source, file).not.toContain("getPlasmoStorageForKey")
    }
  })

  it("keeps prompt feature outside extension key/value storage", () => {
    const file = "src/features/prompt/hooks/use-prompt-templates.ts"
    const source = readFileSync(join(ROOT, file), "utf8")
    expect(source).toContain('from "@/lib/repositories/prompt-templates"')
    expect(source).not.toContain("@plasmohq/storage")
    expect(source).not.toContain("plasmoGlobalStorage")
  })

  it("marks raw global sync alias deprecated", () => {
    const source = readFileSync(
      join(ROOT, "src/lib/plasmo-global-storage.ts"),
      "utf8"
    )
    expect(source).toMatch(
      /@deprecated[\s\S]*export const plasmoGlobalStorage = plasmoSyncStorage/
    )
  })
})
