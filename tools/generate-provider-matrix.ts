#!/usr/bin/env tsx
/**
 * Generates the provider capability matrix page for the docs site.
 *
 * Source of truth: each provider class declares its own
 * `capabilities: ProviderCapabilities` field (literal in the base
 * classes, merged in subclass constructors). This script instantiates
 * each provider with a minimal config, reads the resolved capabilities
 * object, and emits a Markdown table to
 *
 *   docs-src/src/content/docs/concepts/provider-matrix.md
 *
 * which the Starlight build then renders. Re-runs are cheap (<200ms)
 * and the result tracks the code exactly -- adding a new provider or
 * changing a capability flag in TypeScript automatically updates the
 * docs the next time `pnpm docs:build` runs.
 */
import { writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

import { KoboldCppProvider } from "../src/lib/providers/koboldcpp"
import { LlamaCppProvider } from "../src/lib/providers/llama-cpp"
import { LMStudioProvider } from "../src/lib/providers/lm-studio"
import { LocalAIProvider } from "../src/lib/providers/localai"
import { OllamaProvider } from "../src/lib/providers/ollama"
import { OpenAIProvider } from "../src/lib/providers/openai"
import { VllmProvider } from "../src/lib/providers/vllm"
import {
  type LLMProvider,
  type ProviderConfig,
  ProviderId,
  ProviderType
} from "../src/lib/providers/types"

const __dirname = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = join(__dirname, "..")
const OUTPUT_PATH = join(
  REPO_ROOT,
  "docs-src/src/content/docs/concepts/provider-matrix.md"
)

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
      "Recommended baseline. Full feature parity including pull / delete / unload."
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
    notes: "OpenAI-compatible. Adds pull / unload over the OpenAI base."
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
      id: ProviderId.VLLM,
      type: ProviderType.OPENAI,
      name: "vLLM",
      enabled: false,
      baseUrl: "http://localhost:8001/v1"
    },
    build: (c) => new VllmProvider(c),
    notes: "High-throughput OpenAI-compatible inference server."
  },
  {
    config: {
      id: ProviderId.LOCALAI,
      type: ProviderType.OPENAI,
      name: "LocalAI",
      enabled: false,
      baseUrl: "http://localhost:8080/v1"
    },
    build: (c) => new LocalAIProvider(c),
    notes: "OpenAI-compatible with multi-backend model orchestration."
  },
  {
    config: {
      id: ProviderId.KOBOLDCPP,
      type: ProviderType.OPENAI,
      name: "KoboldCPP",
      enabled: false,
      baseUrl: "http://localhost:5001/v1"
    },
    build: (c) => new KoboldCppProvider(c),
    notes: "OpenAI-compatible with KoboldCPP's extended sampler controls."
  },
  {
    config: {
      id: ProviderId.OPENAI,
      type: ProviderType.OPENAI,
      name: "OpenAI-compatible (generic)",
      enabled: false,
      baseUrl: "http://localhost:8000/v1"
    },
    build: (c) => new OpenAIProvider(c),
    notes:
      "Fallback for any OpenAI-compatible server we don't have a dedicated class for."
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

The generator at \`tools/generate-provider-matrix.ts\` instantiates each provider class with a minimal config and reads its \`capabilities: ProviderCapabilities\` field. The same field is the runtime source of truth for the extension UI's capability-aware routing (chat menu, model-management actions, etc.), so any divergence here would already be a bug.

If you're adding a new provider, register it in:

1. \`src/lib/providers/\` (the class itself)
2. \`src/lib/providers/factory.ts\` (the factory map)
3. \`src/lib/providers/manager.ts\` (\`DEFAULT_PROVIDERS\`)
4. \`tools/generate-provider-matrix.ts\` (this generator's \`providers\` array)

The first three are mandatory for the runtime; the fourth keeps the docs honest.
`

writeFileSync(OUTPUT_PATH, markdown, "utf-8")
console.log(`✓ Provider matrix written to ${OUTPUT_PATH.replace(REPO_ROOT + "/", "")}`)
console.log(`  ${providers.length} providers × ${COLUMNS.length} capabilities`)
