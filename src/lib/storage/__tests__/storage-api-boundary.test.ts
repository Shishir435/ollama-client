import { readdirSync, readFileSync, statSync } from "node:fs"
import { join, relative } from "node:path"
import { describe, expect, it } from "vitest"
import { SETTINGS } from "@/lib/storage/settings"

const ROOT = process.cwd()
const SOURCE_ROOT = join(ROOT, "src")

const walk = (directory: string): string[] =>
  readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry)
    return statSync(path).isDirectory() ? walk(path) : [path]
  })

const SCOPE_AWARE_UI = [
  "src/features/chat/hooks/use-speech-settings.ts",
  "src/features/model/hooks/use-model-capability-overrides.ts",
  "src/features/permissions/components/approvals-card.tsx",
  "src/features/web-search/stores/web-search-config-store.ts"
]

const VALIDATED_STRUCTURED_CONSUMERS = [
  "src/background/handlers/handle-chat-with-model.ts",
  "src/background/handlers/handle-selection-action.ts",
  "src/contents/content-config.ts",
  "src/contents/url-filter.ts",
  "src/features/file-upload/hooks/use-file-search.ts",
  "src/features/selection-actions/content-settings.ts",
  "src/lib/embeddings/config.ts",
  "src/lib/embeddings/embedding-client.ts",
  "src/lib/embeddings/embedding-strategy.ts",
  "src/lib/per-site-profiles.ts",
  "src/lib/providers/model-rpc-service.ts",
  "src/lib/providers/selected-model.ts"
]

describe("storage API boundary", () => {
  it("limits raw React storage to legacy provider-config observers", () => {
    const offenders = walk(SOURCE_ROOT)
      .filter(
        (file) =>
          /\.tsx?$/.test(file) &&
          !file.includes("/__tests__/") &&
          !/\.(test|spec)\.[^.]+$/.test(file)
      )
      .filter((file) =>
        readFileSync(file, "utf8").includes("@plasmohq/storage/hook")
      )
      .map((file) => relative(ROOT, file))
      .sort()

    expect(offenders).toEqual([
      "src/features/model/hooks/use-provider-icons.ts",
      "src/features/model/hooks/use-provider-models.ts"
    ])
  })

  it("keeps migrated settings UI behind useSetting descriptors", () => {
    for (const file of SCOPE_AWARE_UI) {
      const source = readFileSync(join(ROOT, file), "utf8")
      expect(source, file).toContain('from "@/hooks/use-setting"')
      expect(source, file).not.toContain("@plasmohq/storage/hook")
      expect(source, file).not.toContain("plasmoGlobalStorage")
      expect(source, file).not.toContain("getPlasmoStorageForKey")
    }
  })

  it("gives high-risk structured settings runtime parsers", () => {
    for (const descriptor of [
      SETTINGS.SELECTED_MODEL_REF,
      SETTINGS.MODEL_CONFIGS,
      SETTINGS.CONTENT_EXTRACTION_CONFIG,
      SETTINGS.PER_SITE_PROFILES,
      SETTINGS.EMBEDDING_CONFIG,
      SETTINGS.FILE_UPLOAD_CONFIG
    ]) {
      expect(descriptor.parser, descriptor.key).toBeDefined()
    }
  })

  it("keeps migrated structured consumers off the deprecated sync alias", () => {
    for (const file of VALIDATED_STRUCTURED_CONSUMERS) {
      const source = readFileSync(join(ROOT, file), "utf8")
      expect(source, file).not.toContain("plasmoGlobalStorage")
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
