#!/usr/bin/env tsx
/**
 * Generates derived Markdown pages for the docs site.
 *
 * Source files stay outside `docs`; Starlight consumes generated
 * pages under `docs/src/content/docs/` during docs builds.
 */
import {
  existsSync,
  readFileSync,
  writeFileSync
} from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

import { AnthropicProvider } from "../src/lib/providers/anthropic"
import { LlamaCppProvider } from "../src/lib/providers/llama-cpp"
import { LMStudioProvider } from "../src/lib/providers/lm-studio"
import { OllamaProvider } from "../src/lib/providers/ollama"
import { OpenAICompatibleProvider } from "../src/lib/providers/openai-compatible"
import {
  type LLMProvider,
  type ProviderConfig,
  ProviderId,
  ProviderType
} from "../src/lib/providers/types"

const __dirname = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = join(__dirname, "..")
const CHANGELOG_INPUT_PATH = join(REPO_ROOT, "CHANGELOG.md")
const CHANGELOG_OUTPUT_PATH = join(
  REPO_ROOT,
  "docs/src/content/docs/about/changelog.md"
)
const PROVIDER_MATRIX_OUTPUT_PATH = join(
  REPO_ROOT,
  "docs/src/content/docs/concepts/provider-matrix.md"
)

function generateChangelogPage() {
  console.log("Generating changelog docs...")

  if (!existsSync(CHANGELOG_INPUT_PATH)) {
    console.error(`CHANGELOG.md not found at ${CHANGELOG_INPUT_PATH}`)
    process.exit(1)
  }

  let changelog = readFileSync(CHANGELOG_INPUT_PATH, "utf-8")

  // Strip the first line so Starlight uses the page title from frontmatter.
  changelog = changelog.replace(/^# Changelog\n/i, "")

  const frontmatter = `---
title: Changelog
description: Release history for Ollama Client.
---
`

  const content = `${frontmatter}
${changelog}
`

  writeFileSync(CHANGELOG_OUTPUT_PATH, content, "utf-8")
  console.log(
    `Generated ${CHANGELOG_OUTPUT_PATH.replace(REPO_ROOT + "/", "")}`
  )
}

/**
 * Stable list of providers to document. Hard-coded so we don't have to
 * import `manager.ts` (which pulls in `@plasmohq/storage` and other
 * browser-only modules). When a new provider lands, add it here and to
 * `src/lib/providers/factory.ts`.
 */
const providers: Array<{
  config: ProviderConfig
  build: (config: ProviderConfig) => LLMProvider
  notes?: string
}> = [
  {
    config: {
      id: ProviderId.OLLAMA,
      type: ProviderType.OLLAMA,
      name: "Ollama",
      enabled: true,
      baseUrl: "http://localhost:11434"
    },
    build: (c) => new OllamaProvider(c),
    notes:
      "Recommended baseline. Full feature parity including tool calling, pull / delete / unload."
  },
  {
    config: {
      id: ProviderId.LM_STUDIO,
      type: ProviderType.OPENAI,
      name: "LM Studio",
      enabled: false,
      baseUrl: "http://localhost:1234/v1"
    },
    build: (c) => new LMStudioProvider(c),
    notes:
      "OpenAI-compatible. Supports tool calling and adds pull / unload over the OpenAI base."
  },
  {
    config: {
      id: ProviderId.LLAMA_CPP,
      type: ProviderType.OPENAI,
      name: "llama.cpp",
      enabled: false,
      baseUrl: "http://localhost:8000/v1"
    },
    build: (c) => new LlamaCppProvider(c),
    notes:
      "Run with `llama-server`. Tool calling supported on recent llama.cpp."
  },
  {
    config: {
      id: "custom:openai:docs",
      type: ProviderType.OPENAI,
      name: "OpenAI-compatible (custom)",
      enabled: false,
      baseUrl: "http://localhost:8080/v1"
    },
    build: (c) => new OpenAICompatibleProvider(c),
    notes:
      "User-added vLLM, LocalAI, KoboldCPP, or another compatible endpoint."
  },
  {
    config: {
      id: "custom:anthropic:docs",
      type: ProviderType.ANTHROPIC,
      name: "Anthropic",
      enabled: false,
      baseUrl: "https://api.anthropic.com/v1"
    },
    build: (c) => new AnthropicProvider(c),
    notes: "Optional remote provider using the native Claude Messages API."
  }
]

/** Capability columns in the order they appear in the table. */
const COLUMNS = [
  { key: "chat", label: "Chat" },
  { key: "embeddings", label: "Embeddings" },
  { key: "modelDiscovery", label: "Model discovery" },
  { key: "modelDetails", label: "Model details" },
  { key: "modelPull", label: "Pull" },
  { key: "modelUnload", label: "Unload" },
  { key: "modelDelete", label: "Delete" },
  { key: "providerVersion", label: "Version" },
  { key: "toolCalling", label: "Tool calling" }
] as const

const check = (supported: boolean) => (supported ? "✓" : "—")

function generateProviderMatrix() {
  console.log("Generating provider matrix docs...")

  const rows = providers.map(({ config, build, notes }) => {
    const instance = build(config)
    const cells = COLUMNS.map((col) =>
      check(instance.capabilities[col.key])
    ).join(" | ")
    return { name: config.name, cells, notes }
  })

  const header = `| Provider | ${COLUMNS.map((c) => c.label).join(" | ")} |`
  const separator = `|---|${COLUMNS.map(() => "---").join("|")}|`
  const tableLines = rows.map((r) => `| **${r.name}** | ${r.cells} |`)

  const notesLines = rows
    .filter((r) => r.notes)
    .map((r) => `- **${r.name}** — ${r.notes}`)

  /*
   * No timestamp in the rendered file: keep the output deterministic so
   * re-running the generator doesn't churn the git diff. Provenance
   * lives in this script + the source files it reads.
   */
  const markdown = `---
title: Provider Capability Matrix
description: Which features each provider supports. Generated from the extension's TypeScript source at build time.
sidebar:
  order: 2
---

This matrix is generated from \`src/lib/providers/*.ts\` on every \`pnpm docs:build\`. When a provider class changes a capability flag, the table here updates automatically the next time docs are rebuilt.

:::note
✓ = supported · — = not supported. "Supported" here means the provider class exposes a working implementation; it does not mean the underlying server is necessarily running on your machine.
:::

${header}
${separator}
${tableLines.join("\n")}

## Notes

${notesLines.join("\n")}

## How this table is built

The generator at \`tools/generate-docs.ts\` instantiates each provider class with a minimal config and reads its \`capabilities: ProviderCapabilities\` field. The same field is the runtime source of truth for the extension UI's capability-aware routing (chat menu, model-management actions, etc.), so any divergence here would already be a bug.

If you're adding a new provider, register it in:

1. \`src/lib/providers/\` (the class itself)
2. \`src/lib/providers/factory.ts\` (the factory map)
3. \`src/lib/providers/manager.ts\` (\`DEFAULT_PROVIDERS\`)
4. \`tools/generate-docs.ts\` (this generator's \`providers\` array)

The first three are mandatory for the runtime; the fourth keeps the docs honest.
`

  writeFileSync(PROVIDER_MATRIX_OUTPUT_PATH, markdown, "utf-8")
  console.log(
    `Generated ${PROVIDER_MATRIX_OUTPUT_PATH.replace(REPO_ROOT + "/", "")}`
  )
  console.log(`  ${providers.length} providers × ${COLUMNS.length} capabilities`)
}

generateProviderMatrix()
generateChangelogPage()
