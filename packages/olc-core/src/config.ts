import { mkdir, readFile, writeFile } from "node:fs/promises"
import { homedir } from "node:os"
import { dirname, join } from "node:path"
import { z } from "zod"
import type { ProviderConfig, RuntimeConfig } from "./types"

const providerSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  type: z.enum(["ollama", "openai-compatible"]),
  enabled: z.boolean(),
  baseUrl: z.string().url(),
  apiKey: z.string().optional(),
  modelId: z.string().optional()
})

const runtimeSchema = z.object({
  schemaVersion: z.literal(1),
  defaultProviderId: z.string().min(1),
  providers: z.array(providerSchema),
  modelMappings: z.record(z.string(), z.string())
})

export const DEFAULT_PROVIDERS: ProviderConfig[] = [
  {
    id: "ollama",
    name: "Ollama",
    type: "ollama",
    enabled: true,
    baseUrl: "http://localhost:11434"
  },
  {
    id: "lm-studio",
    name: "LM Studio",
    type: "openai-compatible",
    enabled: false,
    baseUrl: "http://localhost:1234/v1"
  },
  {
    id: "llama-cpp",
    name: "llama.cpp",
    type: "openai-compatible",
    enabled: false,
    baseUrl: "http://localhost:8000/v1"
  }
]

export const DEFAULT_CONFIG: RuntimeConfig = {
  schemaVersion: 1,
  defaultProviderId: "ollama",
  providers: DEFAULT_PROVIDERS,
  modelMappings: {}
}

export const getDefaultConfigPath = () => {
  const envPath = process.env.OLC_CONFIG_PATH
  if (envPath) return envPath
  return join(homedir(), ".config", "olc", "config.json")
}

const normalizeConfig = (input: RuntimeConfig): RuntimeConfig => {
  const providers = [...input.providers]

  for (const defaultProvider of DEFAULT_PROVIDERS) {
    if (!providers.find((p) => p.id === defaultProvider.id)) {
      providers.push(defaultProvider)
    }
  }

  const defaultProviderExists = providers.some(
    (p) => p.id === input.defaultProviderId
  )

  return {
    ...input,
    providers,
    defaultProviderId: defaultProviderExists
      ? input.defaultProviderId
      : DEFAULT_CONFIG.defaultProviderId
  }
}

export class ConfigStore {
  constructor(private readonly configPath: string = getDefaultConfigPath()) {}

  get path() {
    return this.configPath
  }

  async load(): Promise<RuntimeConfig> {
    try {
      const raw = await readFile(this.configPath, "utf-8")
      const parsed = runtimeSchema.safeParse(JSON.parse(raw))
      if (!parsed.success) {
        throw new Error(`Invalid config format: ${parsed.error.message}`)
      }
      return normalizeConfig(parsed.data)
    } catch (error) {
      const missing =
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        (error as { code?: string }).code === "ENOENT"

      if (!missing) {
        throw error
      }

      await this.save(DEFAULT_CONFIG)
      return DEFAULT_CONFIG
    }
  }

  async save(config: RuntimeConfig): Promise<void> {
    const parsed = runtimeSchema.parse(config)
    await mkdir(dirname(this.configPath), { recursive: true })
    await writeFile(this.configPath, `${JSON.stringify(parsed, null, 2)}\n`)
  }
}
