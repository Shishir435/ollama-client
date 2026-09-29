import { type ChildProcess, spawn } from "node:child_process"
import {
  createWriteStream,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync
} from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { mergeAgentBenchmarkDirectory } from "./merge-agent-benchmark"

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..")
const defaultModel = "codex/gpt-6-luna"
const defaultReasoningEffort = "medium"
const supportedEfforts = [
  "auto",
  "enabled",
  "none",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max"
] as const

interface Options {
  products: Array<"ollama-client" | "nanobrowser">
  model: string
  reasoningEffort: (typeof supportedEfforts)[number]
  baseUrl: string
  nanobrowserExtensionPath: string
  outputRoot: string
  runId: string
  build: boolean
}

interface BenchmarkModel {
  id: string
  reasoning?: { supported_efforts?: string[] }
}

interface RunMetadata {
  startedAt: string
  model: string
  reasoningEffort: string
  baseUrl: string
  extensionBuilds: Partial<Record<"ollamaClient" | "nanobrowser", string>>
  products: Options["products"]
  build: boolean
  gitRevision: string
  modelCatalog?: BenchmarkModel
}

interface RunContext {
  options: Options
  baseUrl: string
  nanobrowserExtensionPath: string
  ollamaClientExtensionPath: string
  runDirectory: string
  runMetadata: RunMetadata
  baseEnv: NodeJS.ProcessEnv
}

const usage = `Run the Ollama Client and Nanobrowser browser-agent benchmarks against olc Codex.

Usage:
  pnpm benchmark:agent:comparison [options]

Options:
  --model <id>                  Model id (default: ${defaultModel})
  --reasoning-effort <level>    ${supportedEfforts.join(", ")} (default: ${defaultReasoningEffort})
  --base-url <url>              olc URL without /v1 (default: http://127.0.0.1:8083)
  --nanobrowser-extension <dir> Nanobrowser extension build; defaults to NANOBROWSER_EXTENSION_PATH
  --only <product>              Run just ollama-client or nanobrowser
  --output-dir <dir>            Artifact root (default: artifacts/e2e/benchmark-runs)
  --run-id <id>                  Name a new output folder; ids must be unique
  --skip-build                  Reuse build/chrome-mv3-prod
  --help                        Show this help

Environment overrides: AGENT_HOSTED_MODEL, AGENT_HOSTED_REASONING_EFFORT,
AGENT_HOSTED_BASE_URL, NANOBROWSER_EXTENSION_PATH, AGENT_BENCHMARK_RUNS_DIR.
`

const parseOptions = (args: string[]): Options => {
  const options: Options = {
    products: ["ollama-client", "nanobrowser"],
    model: process.env.AGENT_HOSTED_MODEL ?? defaultModel,
    reasoningEffort: (process.env.AGENT_HOSTED_REASONING_EFFORT ??
      defaultReasoningEffort) as Options["reasoningEffort"],
    baseUrl: process.env.AGENT_HOSTED_BASE_URL ?? "http://127.0.0.1:8083",
    nanobrowserExtensionPath: process.env.NANOBROWSER_EXTENSION_PATH ?? "",
    outputRoot:
      process.env.AGENT_BENCHMARK_RUNS_DIR ?? "artifacts/e2e/benchmark-runs",
    runId: process.env.AGENT_BENCHMARK_RUN_ID ?? "",
    build: true
  }
  const valueHandlers: Record<string, (value: string) => void> = {
    "--only": (value) => {
      if (value !== "ollama-client" && value !== "nanobrowser")
        throw new Error("Expected --only to be ollama-client or nanobrowser.")
      options.products = [value]
    },
    "--model": (value) => (options.model = value),
    "--reasoning-effort": (value) =>
      (options.reasoningEffort = value as Options["reasoningEffort"]),
    "--base-url": (value) => (options.baseUrl = value),
    "--nanobrowser-extension": (value) =>
      (options.nanobrowserExtensionPath = value),
    "--output-dir": (value) => (options.outputRoot = value),
    "--run-id": (value) => (options.runId = value)
  }

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    const value = args[index + 1]
    if (arg === "--help") {
      console.info(usage)
      process.exit(0)
    }
    if (arg === "--skip-build") {
      options.build = false
      continue
    }
    const handler = valueHandlers[arg]
    if (!handler)
      throw new Error(`Unknown option '${arg}'. Use --help for usage.`)
    if (!value || value.startsWith("--"))
      throw new Error(`Expected a value after ${arg}.`)
    handler(value)
    index += 1
  }

  if (!options.model.trim()) throw new Error("The model id cannot be empty.")
  if (
    options.runId &&
    !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(options.runId)
  )
    throw new Error(
      "The run id must be 1-128 letters, numbers, dots, underscores or dashes, and start with a letter or number."
    )
  if (!supportedEfforts.includes(options.reasoningEffort))
    throw new Error(
      `Unsupported reasoning effort '${options.reasoningEffort}'. Choose one of: ${supportedEfforts.join(", ")}.`
    )
  return options
}

const normalizeBaseUrl = (value: string): string => {
  const url = new URL(value)
  if (url.protocol !== "http:" && url.protocol !== "https:")
    throw new Error("The olc base URL must use HTTP or HTTPS.")
  if (url.pathname === "/v1" || url.pathname === "/v1/") url.pathname = ""
  return url.toString().replace(/\/$/, "")
}

const localExecutable = (name: string): string =>
  resolve(
    repositoryRoot,
    "node_modules",
    ".bin",
    process.platform === "win32" ? `${name}.cmd` : name
  )

const runCommand = (
  command: string,
  args: string[],
  input: { cwd: string; env: NodeJS.ProcessEnv; logPath: string }
): Promise<number> => {
  mkdirSync(dirname(input.logPath), { recursive: true })
  const log = createWriteStream(input.logPath, { flags: "w" })
  console.info(`$ ${command} ${args.join(" ")}`)
  const child = spawn(command, args, {
    cwd: input.cwd,
    env: input.env,
    stdio: ["ignore", "pipe", "pipe"],
    shell: process.platform === "win32"
  })
  child.stdout?.on("data", (chunk: Buffer) => {
    log.write(chunk)
    process.stdout.write(chunk)
  })
  child.stderr?.on("data", (chunk: Buffer) => {
    log.write(chunk)
    process.stderr.write(chunk)
  })
  return new Promise((resolveExit, reject) => {
    child.once("error", (error) => {
      log.end()
      reject(error)
    })
    child.once("close", (code) => {
      log.end()
      resolveExit(code ?? 1)
    })
  })
}

const responseJson = async <T>(url: string): Promise<T> => {
  const response = await fetch(url, { signal: AbortSignal.timeout(10_000) })
  if (!response.ok) throw new Error(`${url} returned HTTP ${response.status}.`)
  return (await response.json()) as T
}

const modelFromCatalog = async (
  baseUrl: string,
  requestedModel: string,
  effort: string
): Promise<BenchmarkModel> => {
  const payload = await responseJson<{ data?: BenchmarkModel[] }>(
    `${baseUrl}/v1/models`
  )
  const model = payload.data?.find(
    (candidate) => candidate.id === requestedModel
  )
  if (!model)
    throw new Error(
      `Model '${requestedModel}' is absent from ${baseUrl}/v1/models.`
    )
  const efforts = model.reasoning?.supported_efforts ?? []
  if (!efforts.includes(effort))
    throw new Error(
      `Model '${requestedModel}' does not advertise reasoning effort '${effort}'. Supported: ${efforts.join(", ") || "none reported"}.`
    )
  return model
}

const waitForHealth = async (
  healthUrl: string,
  child?: ChildProcess,
  timeoutMs = 180_000
): Promise<void> => {
  const deadline = Date.now() + timeoutMs
  let lastError: unknown
  while (Date.now() < deadline) {
    if (child?.exitCode !== null && child?.exitCode !== undefined)
      throw new Error(`olc exited early with status ${child.exitCode}.`)
    try {
      const response = await fetch(healthUrl, {
        signal: AbortSignal.timeout(2_000)
      })
      if (response.ok) return
      lastError = new Error(`HTTP ${response.status}`)
    } catch (error) {
      lastError = error
    }
    await new Promise((resolvePause) => setTimeout(resolvePause, 1_000))
  }
  throw new Error(
    `Timed out waiting for olc at ${healthUrl}: ${String(lastError)}`
  )
}

const launchOlc = (
  env: NodeJS.ProcessEnv,
  logPath: string,
  port: string
): ChildProcess => {
  mkdirSync(dirname(logPath), { recursive: true })
  const log = createWriteStream(logPath, { flags: "w" })
  const child = spawn(
    localExecutable("tsx"),
    [
      "packages/olc/src/cli.ts",
      "--backend",
      "codex",
      "--debug",
      "--port",
      port
    ],
    {
      cwd: repositoryRoot,
      env,
      stdio: ["ignore", "pipe", "pipe"],
      shell: process.platform === "win32"
    }
  )
  child.stdout?.on("data", (chunk: Buffer) => {
    log.write(chunk)
    process.stdout.write(chunk)
  })
  child.stderr?.on("data", (chunk: Buffer) => {
    log.write(chunk)
    process.stderr.write(chunk)
  })
  child.once("close", () => log.end())
  return child
}

const stopOlc = async (child: ChildProcess): Promise<void> => {
  if (child.exitCode !== null || child.signalCode !== null) return
  child.kill("SIGTERM")
  await Promise.race([
    new Promise<void>((resolveExit) =>
      child.once("close", () => resolveExit())
    ),
    new Promise<void>((resolvePause) => setTimeout(resolvePause, 10_000))
  ])
  if (child.exitCode === null && child.signalCode === null)
    child.kill("SIGKILL")
}

const assertExtensionBuild = (path: string, label: string): string => {
  const extensionPath = resolve(repositoryRoot, path)
  if (!existsSync(resolve(extensionPath, "manifest.json")))
    throw new Error(
      `${label} extension build is missing a manifest at ${extensionPath}.`
    )
  return extensionPath
}

const writeRunMetadata = (context: RunContext): void => {
  writeFileSync(
    resolve(context.runDirectory, "run.json"),
    `${JSON.stringify(context.runMetadata, null, 2)}\n`
  )
}

const createRunContext = (options: Options): RunContext => {
  const baseUrl = normalizeBaseUrl(options.baseUrl)
  const nanobrowserExtensionPath = options.products.includes("nanobrowser")
    ? assertExtensionBuild(options.nanobrowserExtensionPath, "Nanobrowser")
    : ""
  const ollamaClientExtensionPath = resolve(
    repositoryRoot,
    "build/chrome-mv3-prod"
  )
  if (!options.build && options.products.includes("ollama-client"))
    assertExtensionBuild("build/chrome-mv3-prod", "Ollama Client")

  const runId =
    options.runId ||
    `${new Date().toISOString().replace(/[:.]/g, "-")}-${options.reasoningEffort}`
  const runDirectory = resolve(repositoryRoot, options.outputRoot, runId)
  mkdirSync(dirname(runDirectory), { recursive: true })
  if (existsSync(runDirectory)) {
    if (process.env.AGENT_BENCHMARK_DOCKER_PREPARED_RUN_ID !== runId)
      throw new Error(
        `Benchmark run directory already exists: ${runDirectory}. Choose a new --run-id so previous partials and logs cannot enter this measurement.`
      )
  } else {
    mkdirSync(runDirectory)
  }
  const extensionBuilds: RunMetadata["extensionBuilds"] = {}
  if (options.products.includes("ollama-client"))
    extensionBuilds.ollamaClient = ollamaClientExtensionPath
  if (options.products.includes("nanobrowser"))
    extensionBuilds.nanobrowser = nanobrowserExtensionPath
  const runMetadata: RunMetadata = {
    startedAt: new Date().toISOString(),
    model: options.model,
    reasoningEffort: options.reasoningEffort,
    baseUrl,
    extensionBuilds,
    products: options.products,
    build: options.build,
    gitRevision: "unknown"
  }
  const context = {
    options,
    baseUrl,
    nanobrowserExtensionPath,
    ollamaClientExtensionPath,
    runDirectory,
    runMetadata,
    baseEnv: {
      ...process.env,
      AGENT_HOSTED_MODEL: options.model,
      AGENT_HOSTED_REASONING_EFFORT: options.reasoningEffort,
      AGENT_HOSTED_BASE_URL: baseUrl
    }
  }
  writeRunMetadata(context)
  return context
}

const readBackendHealth = async (baseUrl: string): Promise<string> => {
  try {
    const health = await responseJson<{ backend?: string }>(`${baseUrl}/health`)
    return health.backend ?? ""
  } catch {
    return ""
  }
}

const ensureOlc = async (
  context: RunContext
): Promise<ChildProcess | undefined> => {
  const loopback = ["127.0.0.1", "localhost", "[::1]"].includes(
    new URL(context.baseUrl).hostname
  )
  let backend = await readBackendHealth(context.baseUrl)
  if (backend && backend !== "codex")
    throw new Error(
      `The service at ${context.baseUrl} is '${backend}', not the olc Codex backend.`
    )
  if (backend === "codex") return undefined
  if (!loopback)
    throw new Error(
      `No olc service answers at ${context.baseUrl}; only a loopback service can be started by this runner.`
    )

  const port = new URL(context.baseUrl).port || "80"
  const child = launchOlc(
    context.baseEnv,
    resolve(context.runDirectory, "olc-codex.log"),
    port
  )
  try {
    await waitForHealth(`${context.baseUrl}/health`, child)
    backend = await readBackendHealth(context.baseUrl)
    if (backend !== "codex")
      throw new Error(
        `Expected the olc Codex backend at ${context.baseUrl}; got '${backend || "unknown"}'.`
      )
    return child
  } catch (error) {
    await stopOlc(child)
    throw error
  }
}

const currentGitRevision = (): Promise<string> =>
  new Promise<string>((resolveRevision) => {
    const child = spawn("git", ["rev-parse", "HEAD"], {
      cwd: repositoryRoot,
      stdio: ["ignore", "pipe", "ignore"]
    })
    let stdout = ""
    child.stdout?.on("data", (chunk: Buffer) => (stdout += chunk.toString()))
    child.once("close", () => resolveRevision(stdout.trim() || "unknown"))
    child.once("error", () => resolveRevision("unknown"))
  })

const recordModelCatalog = async (context: RunContext): Promise<void> => {
  context.runMetadata.modelCatalog = await modelFromCatalog(
    context.baseUrl,
    context.options.model,
    context.options.reasoningEffort
  )
  context.runMetadata.gitRevision = await currentGitRevision()
  writeRunMetadata(context)
}

const buildOllamaClient = async (context: RunContext): Promise<void> => {
  if (
    !context.options.build ||
    !context.options.products.includes("ollama-client")
  )
    return
  const generationCode = await runCommand(
    localExecutable("tsx"),
    ["tools/generate/generate-i18n-resources.ts"],
    {
      cwd: repositoryRoot,
      env: context.baseEnv,
      logPath: resolve(context.runDirectory, "resource-generation.log")
    }
  )
  if (generationCode !== 0)
    throw new Error(`Resource generation exited with ${generationCode}.`)
  const buildCode = await runCommand(localExecutable("wxt"), ["build"], {
    cwd: repositoryRoot,
    env: { ...context.baseEnv, WXT_OUTPUT_DIR: "build/chrome-mv3-prod" },
    logPath: resolve(context.runDirectory, "build.log")
  })
  if (buildCode !== 0) throw new Error(`WXT build exited with ${buildCode}.`)
  assertExtensionBuild("build/chrome-mv3-prod", "Ollama Client")
}

const runProduct = async (
  context: RunContext,
  product: Options["products"][number]
): Promise<void> => {
  const productDirectory = resolve(context.runDirectory, product)
  const benchmarkDirectory = resolve(productDirectory, "benchmark")
  mkdirSync(benchmarkDirectory, { recursive: true })
  const env: NodeJS.ProcessEnv = {
    ...context.baseEnv,
    AGENT_BENCHMARK_ARTIFACT_DIR: productDirectory,
    AGENT_BENCHMARK_OUTPUT_DIR: benchmarkDirectory
  }
  const extensionPath =
    product === "nanobrowser"
      ? context.nanobrowserExtensionPath
      : context.ollamaClientExtensionPath
  if (product === "nanobrowser") {
    env.AGENT_BENCHMARK_PRODUCT = "nanobrowser"
    env.NANOBROWSER_EXTENSION_PATH = context.nanobrowserExtensionPath
  } else {
    delete env.AGENT_BENCHMARK_PRODUCT
    delete env.NANOBROWSER_EXTENSION_PATH
  }

  const testCode = await runCommand(
    localExecutable("playwright"),
    ["test", "--project=chromium-agent-benchmark"],
    {
      cwd: repositoryRoot,
      env,
      logPath: resolve(productDirectory, "playwright.log")
    }
  )
  const mergedDirectory = resolve(productDirectory, "merged")
  const mergeResult = mergeAgentBenchmarkDirectory(
    benchmarkDirectory,
    mergedDirectory
  )
  const mergeLog = [
    ...mergeResult.messages,
    ...mergeResult.errors.map((error) => `ERROR: ${error}`)
  ]
  writeFileSync(
    resolve(productDirectory, "merge.log"),
    `${mergeLog.join("\n")}\n`
  )
  console.info(
    `$ merge-agent-benchmark ${benchmarkDirectory} ${mergedDirectory}`
  )
  for (const message of mergeResult.messages) console.info(message)
  for (const error of mergeResult.errors) console.error(error)
  const status = {
    product,
    extensionPath,
    playwrightExitCode: testCode,
    mergeExitCode: mergeResult.exitCode,
    finishedAt: new Date().toISOString()
  }
  writeFileSync(
    resolve(productDirectory, "status.json"),
    `${JSON.stringify(status, null, 2)}\n`
  )
  if (testCode !== 0 || mergeResult.exitCode !== 0)
    throw new Error(
      `${product} benchmark incomplete (Playwright ${testCode}, merge ${mergeResult.exitCode}); see ${productDirectory}.`
    )
}

const runProducts = async (context: RunContext): Promise<void> => {
  const failures: string[] = []
  for (const product of context.options.products) {
    try {
      await runProduct(context, product)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      failures.push(`${product}: ${message}`)
      const productDirectory = resolve(context.runDirectory, product)
      mkdirSync(productDirectory, { recursive: true })
      const statusPath = resolve(productDirectory, "status.json")
      let existingStatus: Record<string, unknown> = {}
      try {
        const parsed = JSON.parse(readFileSync(statusPath, "utf8")) as unknown
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed))
          existingStatus = parsed as Record<string, unknown>
      } catch {
        // The product may have failed before it wrote a status record.
      }
      writeFileSync(
        statusPath,
        `${JSON.stringify(
          {
            ...existingStatus,
            product,
            status: "failed",
            error: message,
            finishedAt: new Date().toISOString()
          },
          null,
          2
        )}\n`
      )
    }
  }
  if (failures.length > 0) {
    writeFileSync(
      resolve(context.runDirectory, "status.json"),
      `${JSON.stringify(
        { status: "failed", failures, finishedAt: new Date().toISOString() },
        null,
        2
      )}\n`
    )
    throw new Error(
      `Benchmark incomplete: ${failures.join("; ")}. See ${context.runDirectory}.`
    )
  }
}

const writeCompleteStatus = (context: RunContext): void => {
  writeFileSync(
    resolve(context.runDirectory, "status.json"),
    `${JSON.stringify(
      { status: "complete", finishedAt: new Date().toISOString() },
      null,
      2
    )}\n`
  )
}

const withOlc = async (
  context: RunContext,
  work: () => Promise<void>
): Promise<void> => {
  const olcChild = await ensureOlc(context)
  try {
    await work()
  } finally {
    if (olcChild) await stopOlc(olcChild)
  }
}

const main = async () => {
  const context = createRunContext(parseOptions(process.argv.slice(2)))
  await withOlc(context, async () => {
    await recordModelCatalog(context)
    await buildOllamaClient(context)
    await runProducts(context)
    writeCompleteStatus(context)
  })
  console.info(`Benchmark outputs: ${context.runDirectory}`)
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
