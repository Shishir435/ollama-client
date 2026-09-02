import { readdirSync, readFileSync, statSync } from "node:fs"
import { join, relative } from "node:path"

import ts from "typescript"
import { describe, expect, it } from "vitest"

const sourceRoot = join(process.cwd(), "src")
const chatRuntimeRoot = join(process.cwd(), "packages/chat-runtime/src")
const agentRuntimeRoot = join(process.cwd(), "packages/agent-runtime/src")
const contractsRoot = join(process.cwd(), "packages/contracts/src")
const runtimeCoreRoot = join(process.cwd(), "packages/runtime-core/src")

const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry)
    return statSync(path).isDirectory() ? walk(path) : [path]
  })

const productionSources = walk(sourceRoot)
  .filter((path) => /\.(ts|tsx)$/.test(path))
  .filter((path) => !path.endsWith(".d.ts"))
  .map((path) => relative(sourceRoot, path).replaceAll("\\", "/"))
  .filter((path) => !path.includes("__tests__/"))
  .filter((path) => !path.startsWith("test/"))

const referencedModules = (source: string): string[] => {
  const sourceFile = ts.createSourceFile(
    "architecture-boundary.ts",
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX
  )
  const modules: string[] = []
  const visit = (node: ts.Node) => {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      modules.push(node.moduleSpecifier.text)
    } else if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments.length === 1 &&
      ts.isStringLiteral(node.arguments[0])
    ) {
      modules.push(node.arguments[0].text)
    }
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)
  return modules
}

/** Source with block and line comments removed, for rules that read code. */
const withoutComments = (source: string): string =>
  source.replaceAll(/\/\*[\s\S]*?\*\//g, "").replaceAll(/\/\/[^\n]*/g, "")

const importsModule = (source: string, modulePath: RegExp): boolean => {
  const exactModulePath = new RegExp(`^(?:${modulePath.source})$`)
  return referencedModules(source).some((module) =>
    exactModulePath.test(module)
  )
}

/**
 * Value imports only. `import type { Database } from "sql.js"` is erased at
 * compile time and pulls no engine into the bundle, so counting it as a runtime
 * dependency would flag modules that have none.
 */
const importsAtRuntime = (source: string, modulePath: RegExp): boolean =>
  new RegExp(
    String.raw`(?:import\s+(?!type\s)[^;]*?from\s*|import\s*\()\s*["']${modulePath.source}["']`
  ).test(source)

describe("architecture import boundaries", () => {
  it("recognizes every module dependency form used by source contracts", () => {
    const forbidden = /@\/features\/agent\/[^"']+/
    const references = [
      'import "@/features/agent/register"',
      'import { run } from "@/features/agent/runtime"',
      'import type { Agent } from "@/features/agent/types"',
      'export { run } from "@/features/agent/runtime"',
      'export * from "@/features/agent/public"',
      `import {
        run
      } from "@/features/agent/runtime"`,
      `export {
        run
      } from "@/features/agent/runtime"`,
      'const runtime = import("@/features/agent/runtime")'
    ]

    expect(references.every((source) => importsModule(source, forbidden))).toBe(
      true
    )
  })

  it("routes chat-history callers through the public repository facade", () => {
    const allowed = new Set([
      "entrypoints/persistence-verify/main.ts",
      "lib/repositories/chat-history.ts"
    ])
    const offenders = productionSources.filter((file) => {
      if (allowed.has(file)) return false
      const source = readFileSync(join(sourceRoot, file), "utf8")
      return importsModule(
        source,
        /(?:@\/lib\/repositories\/|\.\/)sqlite-chat-history/
      )
    })

    expect(offenders).toEqual([])
  })

  it("keeps SQLite internals out of UI and feature modules", () => {
    const uiRoots = [
      "components/",
      "features/",
      "hooks/",
      "options/",
      "sidepanel/",
      "stores/"
    ]
    const offenders = productionSources.filter((file) => {
      if (!uiRoots.some((root) => file.startsWith(root))) return false
      const source = readFileSync(join(sourceRoot, file), "utf8")
      return importsModule(source, /@\/lib\/sqlite\/(?:db|schema)/)
    })

    expect(offenders).toEqual([])
  })

  it("keeps root stores limited to cross-feature concerns", () => {
    const allowedRootStores = new Set([
      "stores/search-dialog-store.ts",
      "stores/shortcut-store.ts",
      "stores/theme.ts"
    ])
    const rootStores = productionSources.filter(
      (file) => file.startsWith("stores/") && !allowedRootStores.has(file)
    )

    expect(rootStores).toEqual([])
  })

  /**
   * The extension ships one SQLite. Official sqlite-wasm reads the file format
   * on every path there is: the OPFS owner, the survey, the import, the backup
   * restore, and — since 0.13.x — the legacy blob fallback.
   *
   * A new runtime import here is how the second engine comes back, and it comes
   * back permanently: once two engines read the same file, verification is
   * comparing engines instead of checking a migration. That is not hypothetical
   * — the migration surveyed with sql.js and imported with sqlite-wasm until
   * #230, and a disagreement between the two would have surfaced as a table-count
   * mismatch indistinguishable from a real defect.
   *
   * sql.js is a devDependency now, and the only allowed importers are the
   * measurement pages `config/wxt-hooks.ts` strips from store builds. Their
   * fixtures have to *write* blobs in the old topology, which is the one job
   * sql.js was ever needed for.
   */
  it("keeps the sql.js runtime out of everything that ships", () => {
    const allowed = new Set([
      "entrypoints/benchmark/main.ts",
      "entrypoints/spike-opfs/main.ts",
      "entrypoints/persistence-verify/main.ts"
    ])
    const offenders = productionSources.filter((file) => {
      if (allowed.has(file)) return false
      const source = readFileSync(join(sourceRoot, file), "utf8")
      return importsAtRuntime(source, /sql\.js(?:\/[^"']+)?/)
    })

    expect(offenders).toEqual([])
  })

  it("keeps application and infrastructure layers independent of features", () => {
    const lowerLayerRoots = ["application/", "background/", "lib/"]
    const offenders = productionSources.filter((file) => {
      if (!lowerLayerRoots.some((root) => file.startsWith(root))) return false
      const source = readFileSync(join(sourceRoot, file), "utf8")
      return importsModule(source, /@\/features\/[^"']+/)
    })

    expect(offenders).toEqual([])
  })

  it("keeps lower layers independent of background composition", () => {
    const lowerLayerRoots = ["application/", "lib/", "protocol/"]
    const offenders = productionSources.filter((file) => {
      if (!lowerLayerRoots.some((root) => file.startsWith(root))) return false
      const source = readFileSync(join(sourceRoot, file), "utf8")
      return importsModule(source, /@\/background\/[^"']+/)
    })

    expect(offenders).toEqual([])
  })

  it("prevents agent application and features from importing chat", () => {
    const agentRoots = ["application/agent/", "features/agent/"]
    const offenders = productionSources.filter((file) => {
      if (!agentRoots.some((root) => file.startsWith(root))) return false
      const source = readFileSync(join(sourceRoot, file), "utf8")
      return importsModule(
        source,
        /@\/(?:application\/turns|features\/chat)\/[^"']+/
      )
    })

    expect(offenders).toEqual([])
  })

  it("prevents chat application and features from importing agent", () => {
    const chatRoots = ["application/turns/", "features/chat/"]
    const offenders = productionSources.filter((file) => {
      if (!chatRoots.some((root) => file.startsWith(root))) return false
      const source = readFileSync(join(sourceRoot, file), "utf8")
      return importsModule(source, /@\/(?:application|features)\/agent\/[^"']+/)
    })

    expect(offenders).toEqual([])
  })

  it("prevents background agent composition from importing chat", () => {
    const source = readFileSync(
      join(sourceRoot, "background/agent/agent-composition.ts"),
      "utf8"
    )
    const offenders = referencedModules(source).filter((module) =>
      /^@\/(?:application\/turns|features\/chat|background\/turns)\//.test(
        module
      )
    )

    expect(offenders).toEqual([])
  })

  it("allows chat and agent domains to depend on shared infrastructure", () => {
    const references = [
      'import type { AgentRunState } from "@ollama-client/contracts"',
      'import { FEATURE_FLAGS } from "@/lib/feature-flags"',
      'import type { AppFailure } from "@/lib/errors"'
    ]
    const forbidden =
      /@\/(?:application\/turns|features\/(?:agent|chat))\/[^"']+/

    expect(references.some((source) => importsModule(source, forbidden))).toBe(
      false
    )
  })

  it("keeps package candidates free of environment and UI adapters", () => {
    const candidateFiles = productionSources.filter(
      (file) =>
        (file.startsWith("protocol/") &&
          file !== "protocol/extension-client.ts") ||
        file === "application/turns/chat-stream-reducer.ts" ||
        file === "application/turns/turn-contract.ts"
    )
    const forbidden =
      /(?:react(?:\/[^"']+)?|wxt(?:\/[^"']+)?|@\/background\/[^"']+|@\/features\/[^"']+|@\/lib\/(?:browser-api|sqlite\/[^"']+)|@\/lib\/providers\/(?:anthropic|factory|llama-cpp|lm-studio|ollama|openai-compatible))/
    const offenders = candidateFiles.filter((file) => {
      const source = readFileSync(join(sourceRoot, file), "utf8")
      return importsModule(source, forbidden)
    })

    expect(offenders).toEqual([])
  })

  it("keeps the contracts package independent of the extension environment", () => {
    const contractSources = walk(contractsRoot)
      .filter((file) => /\.ts$/.test(file))
      .filter((file) => !file.endsWith(".test.ts"))
    const offenders = contractSources.flatMap((file) => {
      const source = readFileSync(file, "utf8")
      return referencedModules(source)
        .filter((module) => module !== "zod" && !module.startsWith("."))
        .map((module) => ({
          file: relative(contractsRoot, file).replaceAll("\\", "/"),
          module
        }))
    })

    expect(offenders).toEqual([])
  })

  it("keeps runtime-core independent of extension and browser adapters", () => {
    const runtimeSources = walk(runtimeCoreRoot)
      .filter((file) => /\.ts$/.test(file))
      .filter((file) => !file.endsWith(".test.ts"))
    const offenders = runtimeSources.flatMap((file) => {
      const source = readFileSync(file, "utf8")
      return referencedModules(source)
        .filter(
          (module) =>
            !module.startsWith(".") &&
            !module.startsWith("@ollama-client/contracts")
        )
        .map((module) => ({
          file: relative(runtimeCoreRoot, file).replaceAll("\\", "/"),
          module
        }))
    })

    expect(offenders).toEqual([])
  })

  it("keeps chat-runtime behind contracts and relative ports", () => {
    const runtimeSources = walk(chatRuntimeRoot)
      .filter((file) => /\.ts$/.test(file))
      .filter((file) => !file.endsWith(".test.ts"))
    const offenders = runtimeSources.flatMap((file) => {
      const source = readFileSync(file, "utf8")
      return referencedModules(source)
        .filter(
          (module) =>
            !module.startsWith(".") &&
            !module.startsWith("@ollama-client/contracts") &&
            !module.startsWith("@ollama-client/runtime-core")
        )
        .map((module) => ({
          file: relative(chatRuntimeRoot, file).replaceAll("\\", "/"),
          module
        }))
    })

    expect(offenders).toEqual([])
  })

  it("keeps agent-runtime behind contracts and relative ports", () => {
    const runtimeSources = walk(agentRuntimeRoot)
      .filter((file) => /\.ts$/.test(file))
      .filter((file) => !file.endsWith(".test.ts"))
    const offenders = runtimeSources.flatMap((file) => {
      const source = readFileSync(file, "utf8")
      return referencedModules(source)
        .filter(
          (module) =>
            !module.startsWith(".") &&
            !module.startsWith("@ollama-client/contracts")
        )
        .map((module) => ({
          file: relative(agentRuntimeRoot, file).replaceAll("\\", "/"),
          module
        }))
    })

    expect(offenders).toEqual([])
  })

  /**
   * Durable rows are decoded, not asserted.
   *
   * `query` resolves `Record<string, SqlValue>[]`, which flows into a decoder
   * with no cast at all. Every `as unknown as Row[]` that used to sit at these
   * boundaries was therefore not even load-bearing — just an unchecked claim
   * about data a half-applied migration or a newer build can shape differently.
   */
  it("keeps unchecked row assertions out of every module that reads SQL", () => {
    // Scoped by what a module *does*, not where it lives. A directory rule
    // covered the repositories and missed `lib/embeddings/feedback-service.ts`,
    // which read `chunk_feedback` with the identical assertion.
    const offenders = productionSources.filter((file) => {
      // Comments stripped first, so the rule can be *described* where it is
      // implemented without the description tripping it.
      const source = withoutComments(
        readFileSync(join(sourceRoot, file), "utf8")
      )
      if (!importsModule(source, /@\/lib\/sqlite\/db/)) return false
      // Row *collections* only: `X[]`, `[X]`, `Array<X>`. An under-typed
      // browser or library API asserted to an object or function type is a
      // different thing entirely, and these modules legitimately have those.
      return /\bas\s+unknown\s+as\s+(?:readonly\s+)?(?:\[|Array<|[A-Za-z_$][\w$.]*\s*\[\])/.test(
        source
      )
    })

    expect(offenders).toEqual([])
  })

  /**
   * One production path owns model catalog policy.
   *
   * `provider.getModels` is the wire call; `model-discovery.ts` is the policy
   * around it — honour a remembered absence, keep absence distinct from
   * failure, return the verdict instead of throwing. A caller that reaches past
   * it gets none of that, which is how tool gating and the embedding check both
   * ended up re-asking a catalog-less gateway to 404 on a loop.
   *
   * Only two things are exempt, and neither is a directory: the policy owner
   * itself, and `super.getModels` — a subclass falling back to its base wire
   * format, which is one implementation delegating to another rather than a
   * caller skipping the policy. Exempting all of `lib/providers/` would let a
   * future provider-domain service reacquire the bypass unnoticed, which is the
   * same shape as the two callers this rule was written for.
   */
  it("routes model discovery through the shared policy service", () => {
    const offenders = productionSources.filter((file) => {
      if (file === "lib/providers/model-discovery.ts") return false
      const source = readFileSync(join(sourceRoot, file), "utf8").replaceAll(
        /\bsuper\.getModels\s*\(/g,
        ""
      )
      return /\.getModels\s*\(/.test(source)
    })

    expect(offenders).toEqual([])
  })

  it("keeps ProviderManager as a facade over config and mapping storage", () => {
    const source = readFileSync(
      join(sourceRoot, "lib/providers/manager.ts"),
      "utf8"
    )
    const forbidden = referencedModules(source).filter((module) =>
      [
        "@/lib/plasmo-global-storage",
        "@/lib/constants",
        "./provider-config-schema"
      ].includes(module)
    )

    expect(forbidden).toEqual([])
    expect(withoutComments(source)).not.toMatch(
      /ProviderStorageKey|LEGACY_STORAGE_KEYS|MODEL_MAPPINGS/
    )
  })

  it("keeps provider lifecycle wires inside provider adapters", () => {
    const source = withoutComments(
      readFileSync(
        join(sourceRoot, "lib/providers/model-rpc-service.ts"),
        "utf8"
      )
    )

    expect(source).not.toMatch(/provider\.id\s*===\s*ProviderId\./)
    expect(source).not.toMatch(/\/api\/(?:ps|generate|chat|v1\/models)/)
  })

  /**
   * The observer registry is in-memory delivery state and nothing else.
   *
   * It used to share a module with provider generation, which is how a change
   * to how a turn streams became a change to who is listening. Persistence,
   * providers, and the chat handler are the dependencies that would pull the
   * two back together, so they are the ones named here.
   */
  it("keeps durable turn observers free of persistence and generation", () => {
    const source = readFileSync(
      join(sourceRoot, "background/turns/turn-observers.ts"),
      "utf8"
    )
    const offenders = referencedModules(source).filter((module) =>
      /^@\/(?:lib\/repositories|lib\/providers|application|background\/handlers)\//.test(
        module
      )
    )

    expect(offenders).toEqual([])
  })

  /** One module owns the registry's mutable state; the rest go through it. */
  it("keeps durable turn observer state in a single module", () => {
    const offenders = productionSources.filter((file) => {
      if (file === "background/turns/turn-observers.ts") return false
      const source = readFileSync(join(sourceRoot, file), "utf8")
      return /\bturnObservers\b|\bturnRuntimeSnapshots\b|\bturnReconnectLeases\b/.test(
        source
      )
    })

    expect(offenders).toEqual([])
  })

  /**
   * A background-owned stream consumer declares `ChatStreamSink`, not a port.
   *
   * The durable turn runtime used to cast a three-property object to
   * `ChromePort`, asserting `onMessage`, `onDisconnect`, `sender` and
   * `disconnect()` that did not exist. `port-router.ts` keeps the one real
   * adaptation, where an actual `browser.Runtime.Port` is narrowed.
   */
  it("keeps the synthetic port cast out of stream producers", () => {
    const offenders = productionSources.filter((file) => {
      if (file === "background/port-router.ts") return false
      const source = readFileSync(join(sourceRoot, file), "utf8")
      return /as\s+unknown\s+as\s+ChromePort\b/.test(source)
    })

    expect(offenders).toEqual([])
  })
})
