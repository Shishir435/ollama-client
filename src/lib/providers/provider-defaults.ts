import { type ProviderConfig, ProviderId, ProviderType } from "./types"

export const DEFAULT_PROVIDERS: ProviderConfig[] = [
  {
    id: ProviderId.OLLAMA,
    type: ProviderType.OLLAMA,
    name: "Ollama",
    enabled: true,
    baseUrl: "http://localhost:11434"
  },
  {
    id: ProviderId.LM_STUDIO,
    type: ProviderType.OPENAI,
    name: "LM Studio",
    enabled: false,
    baseUrl: "http://localhost:1234/v1"
  },
  {
    id: ProviderId.LLAMA_CPP,
    type: ProviderType.OPENAI,
    name: "llama.cpp",
    enabled: false,
    baseUrl: "http://localhost:8000/v1"
  }
]

export const REMOVED_BETA_DEFAULTS: Record<
  string,
  { baseUrl: string; name: string; customId: string }
> = {
  [ProviderId.VLLM]: {
    baseUrl: "http://localhost:8001/v1",
    name: "vLLM",
    customId: "custom:openai:legacy-vllm"
  },
  [ProviderId.LOCALAI]: {
    baseUrl: "http://localhost:8080/v1",
    name: "LocalAI",
    customId: "custom:openai:legacy-localai"
  },
  [ProviderId.KOBOLDCPP]: {
    baseUrl: "http://localhost:5001/v1",
    name: "KoboldCpp",
    customId: "custom:openai:legacy-koboldcpp"
  }
}
