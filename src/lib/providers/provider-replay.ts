import { createAppError } from "@/lib/error-utils"
import type { ProviderReplayArtifact } from "@/types/chat"

const REPLAY_ARTIFACT_VERSION = 1 as const
const MAX_REPLAY_ARTIFACT_BYTES = 1024 * 1024
const MAX_REPLAY_BLOCKS = 256

type ReplayWire = ProviderReplayArtifact["wire"]
type ReplayBlock = ProviderReplayArtifact["blocks"][number]

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value)

const isOptionalString = (value: unknown): boolean =>
  value === undefined || value === null || typeof value === "string"

const isCommonReasoningDetail = (block: ReplayBlock): boolean =>
  isOptionalString(block.id) &&
  isOptionalString(block.format) &&
  (block.index === undefined ||
    (typeof block.index === "number" &&
      Number.isInteger(block.index) &&
      block.index >= 0))

const isOpenAIReasoningDetail = (block: ReplayBlock): boolean => {
  if (!isCommonReasoningDetail(block)) return false
  if (block.type === "reasoning.summary") {
    return typeof block.summary === "string"
  }
  if (block.type === "reasoning.encrypted") {
    return typeof block.data === "string"
  }
  if (block.type === "reasoning.text") {
    return typeof block.text === "string" && isOptionalString(block.signature)
  }
  return false
}

const isAnthropicContentBlock = (block: ReplayBlock): boolean => {
  if (block.type === "thinking") {
    return (
      typeof block.thinking === "string" && typeof block.signature === "string"
    )
  }
  if (block.type === "redacted_thinking") {
    return typeof block.data === "string"
  }
  if (block.type === "text") return typeof block.text === "string"
  if (block.type === "tool_use") {
    return (
      typeof block.id === "string" &&
      typeof block.name === "string" &&
      isRecord(block.input)
    )
  }
  return false
}

const serializedSize = (value: unknown): number => {
  try {
    return new TextEncoder().encode(JSON.stringify(value)).byteLength
  } catch {
    return Number.POSITIVE_INFINITY
  }
}

const blocksAreValid = (wire: ReplayWire, blocks: ReplayBlock[]): boolean =>
  blocks.length > 0 &&
  blocks.length <= MAX_REPLAY_BLOCKS &&
  blocks.every((block) =>
    wire === "anthropic"
      ? isAnthropicContentBlock(block)
      : isOpenAIReasoningDetail(block)
  )

const artifactIsValid = (
  artifact: unknown
): artifact is ProviderReplayArtifact => {
  if (!isRecord(artifact) || !Array.isArray(artifact.blocks)) return false
  if (!artifact.blocks.every(isRecord)) return false
  if (artifact.version !== REPLAY_ARTIFACT_VERSION) return false
  if (artifact.wire !== "anthropic" && artifact.wire !== "openai") return false
  if (typeof artifact.providerId !== "string" || !artifact.providerId) {
    return false
  }
  if (typeof artifact.model !== "string" || !artifact.model) return false
  return (
    blocksAreValid(artifact.wire, artifact.blocks) &&
    serializedSize(artifact) <= MAX_REPLAY_ARTIFACT_BYTES
  )
}

const invalidReplayError = () =>
  createAppError(
    "Saved provider continuation data is invalid. Retry this turn to continue safely.",
    {
      kind: "validation",
      messageKey: "chat.errors.provider_replay_invalid"
    }
  )

export const createProviderReplayArtifact = (
  wire: ReplayWire,
  providerId: string,
  model: string,
  blocks: ReplayBlock[]
): ProviderReplayArtifact => {
  const artifact: ProviderReplayArtifact = {
    version: REPLAY_ARTIFACT_VERSION,
    wire,
    providerId,
    model,
    blocks
  }
  if (!artifactIsValid(artifact)) throw invalidReplayError()
  return artifact
}

/**
 * Return validated replay blocks only to the adapter that created them.
 * Artifacts from another provider/model are ordinary history and are ignored;
 * a malformed matching artifact fails locally instead of reaching upstream.
 */
export const getProviderReplayBlocks = (
  artifact: ProviderReplayArtifact | undefined,
  expected: { wire: ReplayWire; providerId: string; model: string }
): ReplayBlock[] | undefined => {
  if (!artifact) return undefined
  if (!isRecord(artifact)) throw invalidReplayError()
  if (
    artifact.wire !== expected.wire ||
    artifact.providerId !== expected.providerId ||
    artifact.model !== expected.model
  ) {
    return undefined
  }
  if (!artifactIsValid(artifact)) throw invalidReplayError()
  return artifact.blocks
}

export const parseStoredReplayArtifact = (
  raw: unknown
): ProviderReplayArtifact | undefined => {
  if (typeof raw !== "string" || raw.length === 0) return undefined
  try {
    const parsed: unknown = JSON.parse(raw)
    return artifactIsValid(parsed) ? parsed : undefined
  } catch {
    return undefined
  }
}

export const serializeReplayArtifact = (
  artifact: ProviderReplayArtifact | undefined
): string | null => {
  if (!artifact) return null
  if (!artifactIsValid(artifact)) throw invalidReplayError()
  return JSON.stringify(artifact)
}
